---
paths:
  - "plugins/**/package.json"
  - "plugins/**/tsup.config.ts"
  - "turbo.json"
---

# Plugin Build & Packaging

Active when editing plugin packaging, tsup configs, or the turbo pipeline. Code is built by turbo; `dist/` is committed and CI-verified.

## Build pipeline

- `npm run build:plugin` → `turbo run build:plugin`. `build:plugin` depends on `^build`, so `packages/*` build first, then each plugin bundles with tsup.
- Each plugin's `build:plugin` is `tsc --noEmit && tsup && chmod 755 <entry .js files>`. `tsc --noEmit` typechecks; tsup emits the bundle.
- `danger-patterns` build copies `src/data/*.json` → `dist/data/` so esbuild can inline the embedded system rules.

## Self-contained bundling

Each plugin's `tsup.config.ts` sets `noExternal: [/^@transcodes-guard(-private)?\//]` — both the public (`@transcodes-guard/*`) and private (`@transcodes-guard-private/*`) workspace packages are **bundled in**, never published as separate npm modules. Real runtime deps (`@modelcontextprotocol/sdk`, `zod`, in `dependencies`) stay external. Internal packages therefore live in `devDependencies` on each plugin (tsup auto-bundles devDeps) and stay `private`. The regex's `(-private)?` alternation is the safety net: if a future commit moves a private package into a plugin's `dependencies`, it would otherwise externalize and break the published tarball.

## `files` must ship the host manifest

A plugin's npm `files` array (or what a host reads from the repo) must include not just `dist/` but the host registration files, or the installed plugin is non-functional:

- claude-code: `dist`, `README.md`, `.claude-plugin`, `.mcp.json`, `hooks/hooks.json`
- codex: `dist`, `AGENTS.md`, `README.md`, `plugin.json`, `.mcp.json`, `hooks/hooks.json`
- antigravity: `dist`, `README.md`, `rules`, `plugin.json`, `mcp_config.json`, `hooks.json`
- cursor: `dist`, `README.md`, `.cursor`, `mcp.json`, `install.sh`

The compiled hook scripts ship via `dist/hooks/*.js`; the **manifest** the host reads to register them (`hooks/hooks.json`, plugin.json, etc.) is outside `dist/` and must be listed explicitly.

## `host.ts` ordering (critical)

Every plugin has a one-line `host.ts`: `process.env.TRANSCODES_GUARD_HOST = "<host>"`. Every hook entry and transport entry's **first import** must be `import "../host.js"`. ESM evaluates import declarations in source order, so this runs before the hook-adapters barrel re-export and sets the host env correctly. **Never** put the env-set at module level inside an adapter file — the barrel re-export makes the last adapter win.

## Dist sync (CI-enforced)

After any source change, `npm run build:plugin` and commit all six `dist/` locations in the same change: `packages/*/dist/` + `private-packages/*/dist/` + each `plugins/*/dist/`. CI runs `git diff --exit-code` on all six and fails on drift. Never hand-edit `dist/`.

## Lint + format

`biome.json` at the repo root governs linting and formatting; `npm run check` runs `biome check --write` (lint + format + organize-imports). Lefthook (installed by `npm install` via postinstall) runs the same biome step on staged files at `pre-commit` and `npm run type-check` at `pre-push`. CI runs `npx biome check --reporter=github` non-destructively. Warnings (incl. `noRestrictedImports` for public→private boundary violations) do not fail the build in phase 1; errors do.

## Adding a new host

1. Implement an adapter in `packages/hook-adapters/src/<host>.ts` (the `HookAdapter` interface).
2. Add `plugins/<host>-ai-action-tracker/` with a manifest + thin hook entries sized to the host's event set.
3. Add `plugins/<host>-ai-action-tracker/host.ts` (the single env line); make it every entry's first import.
4. Add CI smoke tests for the host.

No new `stepup-core` / `mcp-server-core` / `danger-patterns` / `transcodes-mcp-tools` / `danger-rules` code — a host is an adapter + a thin shell only.
