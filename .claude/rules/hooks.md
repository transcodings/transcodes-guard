---
paths:
  - "plugins/*/hooks/**/*.ts"
  - "plugins/*/hooks.json"
  - "plugins/*/.cursor/hooks.json"
  - "packages/hook-adapters/src/**/*.ts"
---

# Hooks & Host Adapters

Active when editing plugin hook entries or `packages/hook-adapters/`. This is where — and the **only** place where — host divergence lives. Gate logic stays in `packages/stepup-core/` (see `.claude/rules/stepup-gate.md`).

## Thin entries + adapter isolation

A plugin hook file does almost nothing: import `../host.js` first (see `.claude/rules/plugin-build.md` for why ordering matters), parse stdin via the host adapter, call `evaluatePreToolUse` (or the relevant gate entry), emit via the adapter. The `HookAdapter` interface in `packages/hook-adapters/src/types.ts` abstracts each host's stdin/stdout contract. When a host's wire format is identical to Claude Code's, delegate to `claudeCodeAdapter` rather than duplicating.

## Host wire formats

| Host | Hook events | Format notes |
|------|-------------|--------------|
| Claude Code | 4 (PreToolUse, SessionStart, UserPromptSubmit, Stop) | `hookSpecificOutput` wrapper |
| Codex | 4 (same set) | adopts Claude Code's hook contract verbatim |
| Antigravity | 3 (PreToolUse on `run_command`, PreInvocation, Stop) | native; `PreInvocation` merges SessionStart + UserPromptSubmit |
| Cursor | 4 (beforeShellExecution, sessionStart, beforeSubmitPrompt, stop) + beforeMCPExecution | **flat** format `{ permission, user_message, agent_message }`, **no** `hookSpecificOutput` wrapper; `beforeSubmitPrompt` has no `additional_context` channel (user-prompt detection runs as side effects only) |

See `docs/research/multi-tool-hook-plugin-support.md` for the spec-vs-research reconciliation.

## Output channels (per event)

- **PreToolUse** → stdout JSON, `hookSpecificOutput.permissionDecision` (`"deny"`/`"allow"`) + `systemMessage` (protocol instruction). Cursor uses its flat `permission` field instead.
- **SessionStart / UserPromptSubmit** → stdout JSON, `hookSpecificOutput.additionalContext`.
- **Stop** → stdout JSON, **top-level** `{ decision: "block", reason }`. Stop is not in the `hookSpecificOutput.hookEventName` enum for Claude Code/Codex — never wrap it.
- stderr is for a one-line human-readable summary only.
- **exit code `0` everywhere** — a deny travels in the JSON, not the exit code. Never `exit 2` (legacy stderr-text contract).

## Fast-path must emit explicit allow

When a verified record is consumed, PreToolUse must emit explicit `permissionDecision: "allow"` JSON. Bare `exit 0` falls back to the host's default permission flow, where a settings deny rule or built-in safety pattern can override the step-up verification. Details and consume semantics: `.claude/rules/stepup-gate.md`.

## Hook orchestra

The per-plugin hook set coordinates only through the shared pending file (`cacheDir()/stepup-pending.json`) — hooks cannot call each other or the MCP server. PreToolUse writes pending on first danger match and clears it on fast-path consume; SessionStart/UserPromptSubmit/PreInvocation read it for carry-over and "auth done" detection; Stop reminds on a dangling loop and reaps orphans. **Do not add a step-up hook** — reuse this orchestra or consume the gate from a new MCP tool. State semantics: `.claude/rules/stepup-gate.md`.

## Cross-references

- Gate evaluation, asymmetric fail policy, consume semantics → `.claude/rules/stepup-gate.md`
- What counts as risky (Bash regex + `rm -rf` semantic check, tool-rules) → `.claude/rules/danger-patterns.md`
- `host.ts` ordering, dist sync, adding a new host → `.claude/rules/plugin-build.md`
- Path resolution (`dataDir()`/`cacheDir()`) → `.claude/rules/plugin-paths.md`
