---
paths:
  - ".github/workflows/release.yml"
  - "release-please-config.json"
  - ".release-please-manifest.json"
---

# Release & Distribution

Active when editing the release workflow or release-please config. Version automation is on; **actual publishing is deferred** until a distribution channel is chosen.

## What runs today

`.github/workflows/release.yml` runs **release-please only** (on push to `main`): it reads conventional commits, maintains a Release PR, and on merge produces ① a version bump commit ② the root `CHANGELOG.md` ③ a git tag `transcodes-guard-vX.Y.Z`. **There is no publish step / `NPM_TOKEN`.** Feature development keeps version, CHANGELOG, and tag records flowing; a publish step (or a separate workflow) is added once the channel is decided.

## Version model

- Single root component. Version source of truth = root `package.json` + `.release-please-manifest.json`.
- The four plugin `package.json` + manifest versions are auto-synced via `release-please-config.json` `extra-files`, **same version together**. **Never hand-bump** a plugin version — it breaks train consistency.
- `@bigstrider/transcodes-cli` is not in the version train; only the plugins' `peerDependencies` range declares compatibility.

## Distribution channels (per host, not all npm)

npm is **not** the universal channel — it only fits Claude Code, and even there it is optional:

| Host | Channel | npm? |
|------|---------|------|
| Claude Code | marketplace + git source (repo root is the marketplace, plugin referenced by relative path). npm is an optional `"source":"npm"` entry in `marketplace.json`. | optional |
| Codex | native marketplace (`.agents/plugins/marketplace.json` + `git-subdir`) | no |
| Antigravity | `agy plugin install <git-url>` | no |
| Cursor | `install.sh` writing `.cursor/hooks.json` + `mcp.json` | no |

The common deploy unit is **this git repo**. Plugins do not each need an npm package. Full per-host research and the deploy plan live in `docs/research/multi-host-plugin-distribution.md` — read it before adding any publish step.

## When adding a publish step later

- Gate it behind a human decision (manual `workflow_dispatch` or an environment approval) — publishing is outward-facing and hard to reverse.
- For Claude Code npm: publishing alone is inert; the package becomes installable only when `marketplace.json` references it via `"source":"npm"`.
- Re-check each plugin's `files` array (see `.claude/rules/plugin-build.md`) before any publish.
