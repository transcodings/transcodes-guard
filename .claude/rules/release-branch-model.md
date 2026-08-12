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

- The repo's git **default branch is `prod`**, but **all development targets `dev`**: feat → PR (base `dev`) → merge to `dev` → promote to `prod`. (The development branch was renamed from `main` to `dev`; `prod` stays the public default.)
- **Promotion is a `dev` → `prod` merge PR, not a fast-forward.** Open it with `gh pr create --base prod --head dev` and merge with `--merge` (never squash or rebase — either would rewrite `dev`'s commits onto `prod` and compound the divergence). A human decides when to promote; do not merge a promotion PR without being asked.
- **`prod` is no longer an ancestor of `dev`, and cannot become one again.** Each merge promotion adds a merge commit that exists only on `prod`, so `git merge-base --is-ancestor origin/prod origin/dev` fails. Expect this; it is not a sign that someone committed directly to `prod`. Verify a promotion by diffing content instead: `git diff origin/dev origin/prod` should show only changes `dev` is ahead on.
- **`promote.yml` is therefore dead and always exits 1.** It fast-forwards `prod` to `dev` and refuses on divergence — the guard was correct for the ff era (it last ran successfully 2026-07-01), but from 2026-08-05 promotions have been merges, so its `--is-ancestor` check can never pass again. Do not run it, and do not "fix" a promotion by force-pushing `prod` to make the check pass — that would discard the merge history the public branch already published.
- `release.yml` **must** set `target-branch: dev` even though the default branch is `prod`. Omitting it makes release-please commit version bumps directly to `prod` — independent `prod` work that the next promotion PR would have to merge back, which is how the two branches drift apart in content rather than merely in history.

## Version train (CLI excluded)

- Plugin/marketplace versions are **one synchronized train**: release-please bumps root `package.json` and fans out to `extra-files` — all **4** plugins' `package.json`, all **4** host plugin manifests (`claude-code/.claude-plugin/plugin.json`, `codex/.codex-plugin/plugin.json`, `antigravity/plugin.json`, `cursor/.cursor-plugin/plugin.json`), plus `mcp/package.json` (the standalone MCP package rides the train but publishes manually).
- The **CLI is not in this train**. `@bigstrider/transcodes-cli` bumps independently and ships to npm separately. It keeps the `@bigstrider` scope (not the `@transcodes-guard` rename) and is today the **sole** npm-published unit (`@bigstrider/transcodes-mcp` is version-trained and publishable but not yet released — note it sits outside the `packages/*` privacy gate).
- Every `packages/*` member must keep `"private": true` — CI iterates all of `packages/*` and fails if any lacks it. Only `plugins/*` and `cli` are published; the common deploy unit for plugins is **this git repo made public**, not per-plugin npm packages.
- Every published plugin declares an **optional** peerDependency on `@bigstrider/transcodes-cli` (`>=0.5.0 <0.6.0`, `peerDependenciesMeta.optional`). The range is pinned to the CLI's current minor — because the CLI bumps **outside** this train, a CLI minor bump that leaves the range stale makes `npm ci` ERESOLVE-fail on the next release PR's lockfile rebuild. Move all four plugins' peer range with the CLI minor.

## Per-host deploy divergence

- **Path placeholders differ per host and are substituted differently**: claude-code/codex use `${CLAUDE_PLUGIN_ROOT}` (runtime env); antigravity uses `__PLUGIN_DIR__` (rewritten by `plugins/antigravity/install.mjs` into an isolated plugin dir); cursor uses `${CURSOR_PLUGIN_ROOT}` (rewritten by `plugins/cursor/install.mjs`, merge-aware into user-level `~/.cursor/hooks.json` + `mcp.json`).
- **Antigravity install is plugin-scoped**: writes only `~/.gemini/config/plugins/transcodes-guard/` — no user-level hook/MCP merge needed; other Antigravity plugins are untouched.
- **Cursor `install.mjs` is merge-aware**: it **upserts only transcodes-guard hook entries** in `~/.cursor/hooks.json` (other hooks preserved), and **upserts only `mcpServers.transcodes-guard`** in an existing `~/.cursor/mcp.json`.
- **Only Claude Code ships an HTTP transport** (`src/http.ts`, Streamable HTTP `/mcp`). codex/antigravity/cursor are stdio-only and must not gain an http entry.
- **No host gets host-scoped trusted state.** `core/paths` resolves authorization/policy state to `~/.transcodes/state/`. Short-lived prompt telemetry is the explicit exception and prefers the host-provided writable `PLUGIN_DATA` / `CLAUDE_PLUGIN_DATA` before its `~/.transcodes/cache/prompts` fallback (see [[policy-and-state]]).
