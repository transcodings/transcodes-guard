---
description: The dev/prod branch promotion model, the synchronized version train (and the CLI's exclusion from it), and per-host deploy/manifest divergences.
paths:
  - ".github/workflows/**"
  - "release-please-config.json"
  - "plugins/**"
  - "cli/**"
---

# Release, branch model & per-host deploy

## Branch promotion (counterintuitive: `prod` is the default branch)

- The repo's git **default branch is `prod`**, but **all development targets `dev`**: feat → PR (base `dev`) → merge to `dev` → fast-forward-promote to `prod`. (The development branch was renamed from `main` to `dev`; `prod` stays the public default.)
- `promote.yml` only **fast-forwards** `prod` to `dev` and **refuses** (exit 1, no force-push) if `prod` has diverged — guarded by `git merge-base --is-ancestor origin/prod $DEV_SHA`. `prod` must never receive independent commits.
- `release.yml` **must** set `target-branch: dev` even though the default branch is `prod`. Omitting it makes release-please commit version bumps directly to `prod`, permanently breaking the fast-forward promotion model.

## Version train (CLI excluded)

- Plugin/marketplace versions are **one synchronized train**: release-please bumps root `package.json` and fans out to `extra-files` — all **4** plugins' `package.json` plus the **3** host plugin manifests that exist (`claude-code/.claude-plugin/plugin.json`, `codex/.codex-plugin/plugin.json`, `antigravity/plugin.json`). **Cursor has no plugin manifest** — only its `package.json` is in the train.
- The **CLI is not in this train**. `@bigstrider/transcodes-cli` bumps independently and ships to npm separately. It keeps the `@bigstrider` scope (not the `@transcodes-guard` rename) and is the **sole** npm-published unit.
- Every `packages/*` member must keep `"private": true` — CI iterates all of `packages/*` and fails if any lacks it. Only `plugins/*` and `cli` are published; the common deploy unit for plugins is **this git repo made public**, not per-plugin npm packages.
- Every published plugin declares an **optional** peerDependency on `@bigstrider/transcodes-cli` (`>=0.5.0 <0.6.0`, `peerDependenciesMeta.optional`). The range is pinned to the CLI's current minor — because the CLI bumps **outside** this train, a CLI minor bump that leaves the range stale makes `npm ci` ERESOLVE-fail on the next release PR's lockfile rebuild. Move all four plugins' peer range with the CLI minor.

## Per-host deploy divergence

- **Path placeholders differ per host and are substituted differently**: claude-code/codex use `${CLAUDE_PLUGIN_ROOT}` (runtime env); antigravity uses `__PLUGIN_DIR__` (rewritten by `plugins/antigravity/install.mjs` into an isolated plugin dir); cursor uses `${CURSOR_PLUGIN_ROOT}` (rewritten by `plugins/cursor/install.mjs`, merge-aware into user-level `~/.cursor/hooks.json` + `mcp.json`).
- **Antigravity install is plugin-scoped**: writes only `~/.gemini/config/plugins/transcodes-guard/` — no user-level hook/MCP merge needed; other Antigravity plugins are untouched.
- **Cursor `install.mjs` is merge-aware**: it **upserts only transcodes-guard hook entries** in `~/.cursor/hooks.json` (other hooks preserved), and **upserts only `mcpServers.transcodes-guard`** in an existing `~/.cursor/mcp.json`.
- **Only Claude Code ships an HTTP transport** (`src/http.ts`, Streamable HTTP `/mcp`). codex/antigravity/cursor are stdio-only and must not gain an http entry.
- **Only claude-code benefits from a host-scoped data dir.** codex/antigravity/cursor `host.ts` deliberately do *not* set a `$CLAUDE_PLUGIN_DATA` equivalent — those hosts have none, so `core/paths` falls back to the consolidated host-agnostic path (see [[policy-and-state]]).
