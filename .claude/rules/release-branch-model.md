---
description: The main/prod branch promotion model, the synchronized version train (and the CLI's exclusion from it), and per-host deploy/manifest divergences.
paths:
  - ".github/workflows/**"
  - "release-please-config.json"
  - "plugins/**"
  - "cli/**"
---

# Release, branch model & per-host deploy

## Branch promotion (counterintuitive: `prod` is the default branch)

- The repo's git **default branch is `prod`**, but **all development targets `main`**: feat → PR (base `main`) → merge to `main` → fast-forward-promote to `prod`.
- `promote.yml` only **fast-forwards** `prod` to `main` and **refuses** (exit 1, no force-push) if `prod` has diverged — guarded by `git merge-base --is-ancestor origin/prod $MAIN_SHA`. `prod` must never receive independent commits.
- `release.yml` **must** set `target-branch: main` even though the default branch is `prod`. Omitting it makes release-please commit version bumps directly to `prod`, permanently breaking the fast-forward promotion model.

## Version train (CLI excluded)

- Plugin/marketplace versions are **one synchronized train**: release-please bumps root `package.json` and fans out to `extra-files` — all **4** plugins' `package.json` plus the **3** host plugin manifests that exist (`claude-code/.claude-plugin/plugin.json`, `codex/.codex-plugin/plugin.json`, `antigravity/plugin.json`). **Cursor has no plugin manifest** — only its `package.json` is in the train.
- The **CLI is not in this train**. `@bigstrider/transcodes-cli` bumps independently and ships to npm separately. It keeps the `@bigstrider` scope (not the `@transcodes-guard` rename) and is the **sole** npm-published unit.
- Every `packages/*` member must keep `"private": true` — CI iterates all of `packages/*` and fails if any lacks it. Only `plugins/*` and `cli` are published; the common deploy unit for plugins is **this git repo made public**, not per-plugin npm packages.
- Every published plugin declares an **optional** peerDependency on `@bigstrider/transcodes-cli` (`>=0.3.0 <0.5.0`, `peerDependenciesMeta.optional`).

## Per-host deploy divergence

- **Path placeholders differ per host and are substituted differently**: claude-code/codex use `${CLAUDE_PLUGIN_ROOT}` (runtime env); antigravity uses `__PLUGIN_DIR__`; cursor uses `__TRANSCODES_GUARD_ROOT__` (sed-replaced to an absolute path by `install.sh`).
- **Antigravity `hooks.json` is host-divergent**: a named top-level key (`transcodes-guard-stepup`) wraps the events, and `PreInvocation`/`Stop` are bare command objects — *not* the `{hooks:[...]}` array Claude/Codex use.
- **Cursor `install.sh` is merge-aware**: it always renders/overwrites `.cursor/hooks.json`, but **refuses to clobber an existing `.cursor/mcp.json`** (prints the entry for manual addition) to preserve the user's other MCP servers.
- **Only Claude Code ships an HTTP transport** (`src/http.ts`, Streamable HTTP `/mcp`). codex/antigravity/cursor are stdio-only and must not gain an http entry.
- **Only claude-code benefits from a host-scoped data dir.** codex/antigravity/cursor `host.ts` deliberately do *not* set a `$CLAUDE_PLUGIN_DATA` equivalent — those hosts have none, so `plugin-paths` falls back to the consolidated host-agnostic path (see [[policy-and-state]]).
