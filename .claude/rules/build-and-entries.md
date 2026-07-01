---
description: Committed-dist discipline, why bundles aren't byte-reproducible, the tsup inlining rules, and the per-host entry/manifest layout that hosts run from a git clone.
paths:
  - "plugins/**"
  - "turbo.json"
  - "biome.json"
  - "lefthook.yml"
  - "package.json"
  - ".github/workflows/**"
---

# Build & entry-point discipline

Hosts run committed `dist/` straight from a **git clone with no `node_modules`**. That single fact drives most of the rules below.

## Committed dist

- Commit `packages/*/dist` and `plugins/*/dist` (tracked via `.gitignore` negation globs: `!packages/*/dist/**`, `!plugins/*/dist/**`). **Never** commit `cli/dist` — it's re-ignored after the broad un-ignore and bundled fresh at npm publish.
- **Contributors are not required to rebuild `dist/` on feature branches.** `release.yml` rebuilds and commits `dist/` on the Release PR, so the release **tag** (the actual deploy unit) is always fresh; stale `dist/` on a mid-cycle `dev` is harmless because hosts install from a tag. Rebuild (`npm run build:plugin`) only to verify locally — CI rebuilds fresh on every push regardless of what you committed.
- `dist/` carries `.gitattributes` (`linguist-generated -diff`): GitHub collapses it in PR diffs and git suppresses its textual diff. It stays fully tracked and shippable — only its display is muted, since the bundles are generated and non-byte-reproducible.
- `build:plugin` runs a `prebuild:plugin` step that **generates committed source**: `scripts/stamp-build-info.mjs` stamps the version into `packages/mcp-server-core/src/build-info.ts` + `plugins/*/src/version.ts`, and `scripts/generate-router-files.mjs` renders the `/transcodes` body from the single source `scripts/router-body.mjs` into `packages/mcp-server-core/src/router-body.ts` + the four per-host command/skill files. All are committed source (not gitignored); hand-edits are overwritten each build. CI runs `generate-router-files.mjs --check` **before** `build:plugin` (the build's `prebuild:plugin` would otherwise regenerate these files and the check would compare them against themselves), so committed router drift fails the build.

## No byte-identity gate

- Do **not** add a `git diff --exit-code` byte-identity gate on `dist`. esbuild embeds hoist-dependent relative module paths into content-hashed chunk names, so bundle output is intentionally **non-reproducible** across environments.
- Freshness is guarded only by: (a) `build:plugin` succeeding, (b) the **gitignore-existence guard**, (c) the **20 smoke tests** (claude-code 6 + codex 3 + antigravity 5 + cursor 6).
- The existence guard exists because a `git diff` freshness check passes silently (no diff) when a negation glob stops matching and `dist` becomes ignored — so CI asserts the compiled hook entry files (`plugins/*/dist/hooks/pre-tool-use.js`) physically exist on disk.

## tsup config invariants

- **`noExternal` must inline** the workspace scope (`/^@transcodes-guard(-private)?\//`) **and** the runtime deps `zod` and `@modelcontextprotocol/sdk`. Declaring them as `dependencies` is not enough — externalizing them throws `ERR_MODULE_NOT_FOUND` in real installs (works only in-workspace via hoisting).
- **No `banner` shebang** in plugin tsup configs: the `#!/usr/bin/env node` is hand-written on each executable entry source and esbuild preserves it, while `splitting: true` keeps shared chunks shebang-free. (The **CLI** tsup *does* set a `banner` shebang — it's a single, non-split entry.)
- **Entry KEYS mirror the dist path layout** (e.g. `'src/stdio'`, `'hooks/pre-tool-use'`) because the host manifests (`.mcp.json`, `hooks.json`, `bin`) point at those exact `dist/` paths.
- **`host.ts` is NOT a tsup entry** — it's a side-effect module pulled in by each entry's first `import '../host.js'` (see [[boundary-and-seams]]). Never add it to the entry map.
- Each plugin's `build:plugin` must `chmod 755` exactly its emitted entry `.js` files, and the set differs per host: claude-code has `http.js` + 4 hooks, codex/cursor 4 hooks (no http), antigravity 3 hooks.

## Lint / hook tooling

- biome `noRestrictedImports` (the gate-backend firewall, see [[boundary-and-seams]]) runs in CI as `biome check --reporter=github` with **no `--write`** — any violation fails the build.
- `lefthook` **pre-commit must stay `parallel: false`**: format and check touch overlapping staged files and concurrent biome runs corrupt each other. **pre-push is `piped: true`** so multi-stage type-check aborts on first failure.
- `postinstall` installs lefthook only when not in CI (`[ -z "$CI" ]`) — a no-op in CI so `npm ci` doesn't fail on hook install.
