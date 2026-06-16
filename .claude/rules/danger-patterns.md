---
paths:
  - "packages/danger-patterns/src/**/*.ts"
  - "packages/danger-patterns/src/data/*.json"
  - "packages/danger-rules/src/**/*.ts"
  - "packages/danger-rules/src/data/*.json"
---

# Danger Patterns & Tool Rules

Two parallel registries, two packages — same mental model, opposite privacy.

- `packages/danger-patterns/` (**public**) — Bash regex registry. Generic system patterns (e.g. `rm -rf` against an absolute path). Safe to publish.
- `packages/danger-rules/` (**private**) — MCP + remote Bash tool-rule registry. Transcodes-specific protected-tool ↔ `stepupAction`/`stepupResource` policy mappings; the toolName list itself is policy surface that should not be public.

This file is active when editing either package.

## Two trigger sources

- **Bash** — regex match against `packages/danger-patterns/src/data/danger-patterns.json` (system) + cached policy-bundle bash rules (`type:'bash'`, regex in `name`) + an `rm -rf` git-semantic check (is the target git-tracked?).
- **MCP tool call** — exact/glob `toolName` match against `packages/danger-rules/src/data/tool-rules.json` (system) + cached bundle MCP rules. Plugin matcher: `Bash|mcp__plugin_transcodes-guard_transcodes-guard__.*`.

A new protected MCP tool goes into `packages/danger-rules/src/data/tool-rules.json` (system) or via the `add_tool_rule` MCP tool (remote, `type:'mcp'`). A new Bash pattern goes via `add_user_pattern` (remote, `type:'bash'`, regex in `name`).

## System vs remote (bundle) rules

- **System** bash patterns are embedded at build time via a static import (`import data from "./data/danger-patterns.json" with { type: "json" }`). This is **mandatory** — plugins ship as tsup bundles, so a runtime `import.meta.url`-relative read would resolve to the bundle's location, not this package's data dir. JSON lives under `src/data/` to stay inside tsconfig `rootDir`; the build copies it to `dist/data/` for esbuild to inline.
- **Remote (bundle)** bash and MCP rules live in the backend `projects_guard_rules` collection, fetched via the policy bundle and cached under `cacheDir()/policy-bundle-<projectId>.json` (see `.claude/rules/plugin-paths.md`). MCP tools `add_user_pattern` / `add_tool_rule` write through the backend API; there is no local `user-patterns.json` authoring surface.

System rule ids are reserved: remote rules cannot override system ids (`validateNewToolRule` enforces this).

## Matching

`findFirstMatch(command, loadEffectivePatterns())` runs each compiled regex against the **full command string** — comments, quoted args, and heredocs are all matched, there is no command-token extraction. First match wins (`[...system, ...bundle]` order).

This breadth is why a regex must match the *command's intent*, not just a word's appearance. A pattern keyed on a bare word that is also a common identifier in this repo (the repo dir, the `transcodes-guard` package name, the `transcodes` CLI) will false-positive pervasively — prefer command-start anchors over enumerating excluded lead characters in a lookbehind.

## Validation rules

- `id` must match `/^[a-z0-9][a-z0-9-]*$/`.
- Bash `name` (regex) must compile (`new RegExp` in `validateNewToolRule`).
- `description` must be non-empty after trim.
- Bash rules require `matcher:'regex'`, `action`, and `resource`.
- Adding/updating/removing remote bash rules goes through `validateNewToolRule` + backend API (`add_user_pattern` / `update_user_pattern` / `remove_user_pattern`).
