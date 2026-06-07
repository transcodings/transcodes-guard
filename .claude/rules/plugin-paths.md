---
paths:
  - "packages/plugin-paths/src/**/*.ts"
---

# Plugin Paths

Active when editing `packages/plugin-paths/`. This package is the only place that resolves where persistent and cache state lives. Every other package must call its helpers — never join `os.homedir()` or hardcode `~/.claude/...`.

## API

- `detectHost()` — reads `TRANSCODES_GUARD_HOST` (set by each plugin's `host.ts`); falls back to a default.
- `dataDir()` — persistent state (user rules, etc.). Intent: survive across sessions.
- `cacheDir()` — short-lived step-up state (`stepup-pending.json`, verified record). Intent: disposable cache.
- `migrateLegacyFile(name, kind)` — call at the first read entry point for any new persistent file, so existing users' data migrates automatically.

## Resolution rules

- When `CLAUDE_PLUGIN_DATA` is set **and** host is `claude-code`, data/cache isolate under the plugin-data directory.
- Otherwise fall back to legacy paths (`~/.claude/ai-action-tracker/` or `~/.cache/ai-action-tracker/`).
- New persistent files: use `dataDir()` and add a `migrateLegacyFile(name, "data")` call at first read. New cache files: use `cacheDir()`.

## The CLI-owned `~/.transcodes/` boundary

Distinct from `dataDir()`/`cacheDir()`: the `transcodes` CLI (external package, see root `CLAUDE.md`) owns `~/.transcodes/`:

- `~/.transcodes/config.json` — member MCP token storage (`resolveToken()` reads env → this file). The one fixed path the CLI and all four host hooks share. Hooks **read** tokens; they do not own or rewrite the file.
- `~/.transcodes/state/` — consolidated local plugin state.

Do not route plugin-managed files into `~/.transcodes/` — that namespace belongs to the CLI. Use `dataDir()`/`cacheDir()` for anything this repo owns.
