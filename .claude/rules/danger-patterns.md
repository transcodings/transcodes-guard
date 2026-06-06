---
paths:
  - "packages/danger-patterns/src/**/*.ts"
  - "packages/danger-patterns/src/data/*.json"
  - "private-packages/danger-rules/src/**/*.ts"
  - "private-packages/danger-rules/src/data/*.json"
---

# Danger Patterns & Tool Rules

Two parallel registries, two packages — same mental model, opposite privacy.

- `packages/danger-patterns/` (**public**) — Bash regex registry. Generic system patterns (e.g. `rm -rf` against an absolute path) + a user-CRUD surface. Safe to publish.
- `private-packages/danger-rules/` (**private**) — MCP tool-rule registry. Transcodes-specific protected-tool ↔ `stepupAction`/`stepupResource` policy mappings; the toolName list itself is policy surface that should not be public.

This file is active when editing either package.

## Two trigger sources

- **Bash** — regex match against `packages/danger-patterns/src/data/danger-patterns.json` + an `rm -rf` git-semantic check (is the target git-tracked?).
- **MCP tool call** — exact `toolName` match against `private-packages/danger-rules/src/data/tool-rules.json`. Plugin matcher: `Bash|mcp__plugin_transcodes-guard_transcodes-guard__.*`.

A new protected MCP tool goes into `private-packages/danger-rules/src/data/tool-rules.json` (system) or via the `add_tool_rule` MCP tool (user).

## System vs user rules

- **System** rules are embedded at build time via a static import (`import data from "./data/danger-patterns.json" with { type: "json" }`). This is **mandatory** — plugins ship as tsup bundles, so a runtime `import.meta.url`-relative read would resolve to the bundle's location, not this package's data dir. JSON lives under `src/data/` to stay inside tsconfig `rootDir`; the build copies it to `dist/data/` for esbuild to inline.
- **User** rules live in `dataDir()/user-patterns.json` and `dataDir()/user-tool-rules.json` (see `.claude/rules/plugin-paths.md`). Parsed as **JSONC** (`jsonc-parser`) — `//` comments and trailing commas tolerated, so a user can comment out a rule by hand. MCP-tool writes do a full `JSON.stringify` rewrite, so hand-edited comments are not preserved; say so in any tool description.

System rule ids are reserved: user rules cannot override, modify, or remove them (`validateNewPattern` / `updateUserPattern` / `removeUserPattern` enforce this).

## Matching

`findFirstMatch(command, loadMergedPatterns())` runs each compiled regex against the **full command string** — comments, quoted args, and heredocs are all matched, there is no command-token extraction. First match wins (`[...system, ...user]` order). Invalid user regexes are skipped, not fatal.

This breadth is why a regex must match the *command's intent*, not just a word's appearance. A pattern keyed on a bare word that is also a common identifier in this repo (the repo dir, the `transcodes-guard` package name, the `transcodes` CLI) will false-positive pervasively — prefer command-start anchors over enumerating excluded lead characters in a lookbehind.

## Validation rules

- `id` must match `/^[a-z0-9][a-z0-9-]*$/`.
- `regex` must compile (`new RegExp` in `validateNewPattern`).
- `reason` must be non-empty after trim.
- Adding/updating/removing user rules always re-validates through the single `validateNewPattern` path.
