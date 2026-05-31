---
paths:
  - "packages/danger-patterns/src/**/*.ts"
  - "packages/danger-patterns/src/data/*.json"
---

# Danger Patterns & Tool Rules

Active when editing `packages/danger-patterns/`. This package decides what the PreToolUse hook treats as risky. Two trigger sources route through the same hook.

## Two trigger sources

- **Bash** — regex match against `src/data/danger-patterns.json` + an `rm -rf` git-semantic check (is the target git-tracked?).
- **MCP tool call** — exact `toolName` match against `src/data/tool-rules.json`. Plugin matcher: `Bash|mcp__plugin_transcodes-guard_transcodes-guard__.*`.

A new protected MCP tool goes into `src/data/tool-rules.json` (system) or via the `add_tool_rule` MCP tool (user).

## System vs user rules

- **System** rules are embedded at build time via a static import (`import data from "./data/danger-patterns.json" with { type: "json" }`). This is **mandatory** — plugins ship as tsup bundles, so a runtime `import.meta.url`-relative read would resolve to the bundle's location, not this package's data dir. JSON lives under `src/data/` to stay inside tsconfig `rootDir`; the build copies it to `dist/data/` for esbuild to inline.
- **User** rules live in `dataDir()/user-patterns.json` and `dataDir()/user-tool-rules.json` (see `.claude/rules/plugin-paths.md`). Parsed as **JSONC** (`jsonc-parser`) — `//` comments and trailing commas tolerated, so a user can comment out a rule by hand. MCP-tool writes do a full `JSON.stringify` rewrite, so hand-edited comments are not preserved; say so in any tool description.

System rule ids are reserved: user rules cannot override, modify, or remove them (`validateNewPattern` / `updateUserPattern` / `removeUserPattern` enforce this).

## Matching

`findFirstMatch(command, loadMergedPatterns())` runs each compiled regex against the **full command string** — comments, quoted args, and heredocs are all matched, there is no command-token extraction. First match wins (`[...system, ...user]` order). Invalid user regexes are skipped, not fatal.

This breadth is why a regex must match the *command's intent*, not just a word's appearance. A pattern keyed on a bare word that is also a common identifier in this repo (the repo dir, the `transcodes-guard` package name, the `transcodes` CLI) will false-positive pervasively — prefer command-start anchors over enumerating excluded lead characters in a lookbehind.

## Self-gate caveat when working here

This repo's own PreToolUse gate is active during development, and its working directory path contains `transcodes`. The `tracker-self-disable` pattern (`\btranscodes\b[^\n]*\bdisable\b`) can false-match your own Bash commands (e.g. a commit message or branch name containing both words). Avoid putting `transcodes … disable` literals on one command line; use `git commit -F <file>` and investigate code with Read/Glob/Grep rather than `grep` shell commands. See the user-memory note for the full workaround.

## Validation rules

- `id` must match `/^[a-z0-9][a-z0-9-]*$/`.
- `regex` must compile (`new RegExp` in `validateNewPattern`).
- `reason` must be non-empty after trim.
- Adding/updating/removing user rules always re-validates through the single `validateNewPattern` path.
