---
paths:
  - "plugins/ai-action-tracker/hooks/**/*.ts"
---

# Hook Source Rules

Active when editing `plugins/ai-action-tracker/hooks/**/*.ts`. Pair with the project-wide `CLAUDE.md` and `docs/architecture.md` §5 (hook orchestra).

## Output channels are per-hook

Claude Code's hook validator accepts a different JSON shape for each hook type. Mixing them silently rejects the payload.

| Hook | Required stdout JSON |
|------|----------------------|
| `PreToolUse` | `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" \| "allow", permissionDecisionReason }, systemMessage? }` |
| `SessionStart` | `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }` |
| `UserPromptSubmit` | `{ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }` |
| `Stop` | `{ decision: "block", reason }` — **top-level**, no `hookSpecificOutput` wrapper. Stop is excluded from the `hookEventName` enum, so wrapping rejects the payload as "Invalid input". |

Exit code is `0` everywhere — even on deny, because the decision lives in the JSON. Never use `exit 2` in hook code; that is the legacy stderr-text contract.

stderr is for human-readable 1-line summaries only (e.g. `STEPUP-PENDING sid=…`). Never log JSON or multi-line context to stderr — it shows up in the user's terminal verbatim.

## PreToolUse: asymmetric fail policy

The PreToolUse hook decides between two failure modes based on *when* the failure happens:

- **Before** a danger pattern match (stdin parse, pattern file load, command extraction) → **fail-open**: exit 0 with no JSON. A buggy guard must not brick the workflow.
- **After** a danger pattern match (step-up create, browser launch, pending file write) → **fail-safe**: exit 0 with stdout `permissionDecision: "deny"` JSON. If we cannot prove the user authorised the command, we deny.

Emit the deny JSON *before* any post-match work that can throw. Order is load-bearing — if `writePending` throws, the deny must already be on stdout.

## PreToolUse: fast-path MUST emit explicit allow

When `readVerified()` returns a record, the fast path must emit:

```ts
{ hookSpecificOutput: { permissionDecision: "allow", permissionDecisionReason: "…" } }
```

`exit 0` alone is **not enough** — it falls through to Claude Code's default permission flow, which will check `settings.json permissions.deny` and built-in safety patterns and may still block. The explicit allow JSON is what makes the step-up gate an authority source rather than an extra safety net.

After emit, call `consumeVerified()` + `clearPending()` (single-shot policy) and `exit 0`.

## Hook orchestra: coordinate via the shared pending file

The four hooks cannot talk to each other or to the MCP server directly. They share state through a single file managed by `plugins/ai-action-tracker/src/stepup/pending.ts`:

- **PreToolUse** writes pending on first danger match; clears pending on fast-path consume.
- **SessionStart** reads pending to inject a carry-over context block on session resume.
- **UserPromptSubmit** reads pending to detect user "auth done" messages while a session is in flight.
- **Stop** reads pending to remind the model if the loop was left dangling.

Do not introduce a fifth hook for step-up. Extend one of the four or consume the gate via `plugins/ai-action-tracker/src/stepup/gate.ts` from a new MCP tool instead.

## Recommended MCP tool to surface in deny/reminder text

Always recommend `poll_stepup_session_wait` (server-side long-polling, one call replaces 60 manual polls). The legacy single-shot `poll_stepup_session` exists for diagnostics; do not embed it in user-facing protocol instructions.

## Two-layer Bash check (PreToolUse only)

1. Regex layer (`plugins/ai-action-tracker/hooks/danger-patterns.json` + user patterns from `~/.claude/ai-action-tracker/user-patterns.json`) — fast, decidable on the command string alone.
2. `rm -rf` semantic layer — resolves each target relative to the session `cwd`, runs `git ls-files`, and blocks if any target contains tracked files. Catches relative paths like `rm -rf src` that the regex misses.

When adding a new check, decide which layer fits. Add to the regex layer for shape-recognisable danger; add a new semantic check only if the danger depends on filesystem state.

## Self-verification Before "Done"

- `npm run build:plugin` passes and `plugins/ai-action-tracker/dist/` is committed in the same change. CI (`git diff --exit-code -- plugins/ai-action-tracker/dist/`) fails if source and dist drift apart.
- CI hook smoke tests still pass: `rm -rf /` produces stdout JSON with `"permissionDecision":"deny"`; `ls` produces empty stdout and exit 0.
- Diagnostic verification via the MCP tool `simulate_hook_invocation` — spawns the actual hook binary with a controlled payload and returns the structured diff. Prefer this over wrapping `cat ~/.cache/.../stepup-*.json` or piping the hook manually.
