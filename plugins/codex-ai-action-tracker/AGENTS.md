# transcodes-guard — Codex CLI agent guidance

Codex reads this file at the start of every turn (per [`AGENTS.md` spec](https://developers.openai.com/codex/guides/agents-md)). It contains the static step-up MFA protocol primer the agent needs whenever a PreToolUse hook denies a Bash or MCP call.

## Step-up MFA protocol

When a `PreToolUse` hook denies a Bash or MCP tool call with `permissionDecision: "deny"` and the reason mentions Step-up MFA, the command was **BLOCKED and did NOT execute**. Drive the loop deterministically — **do NOT wait for user confirmation between steps**:

1. Tell the user (one short line) to complete WebAuthn in the auto-opened browser tab (paste the URL from the deny message if it did not open).
2. Immediately call the MCP tool `poll_stepup_session_wait` with the provided `sid`. It blocks until verified or the 60s timeout — a single call replaces the manual polling loop. (The legacy single-shot `poll_stepup_session` is for diagnostics only.)
3. On `outcome: "verified"` retry the **same** Bash or MCP call — the hook detects the verified state locally and allows it. On `outcome: "timeout"` ask the user to retry WebAuthn, then call the wait tool again.

**Never** assume the blocked command ran. **Never** invent an alternative command. Always resume from the pending `sid` the hook reported.

## Diagnostics

When step-up state looks inconsistent (e.g. the hook keeps denying after you think it should allow), call the MCP tool `inspect_stepup_state` for a read-only structured snapshot of the `verified` / `pending` / `browser_lock` files. Prefer this over wrapping `cat` or `ls` over the cache directory — it returns server-computed `age_ms`, `expired`, and `ttl_ms`.

To simulate a hook invocation end-to-end with state diff, call `simulate_hook_invocation`. It spawns the actual hook binary in a subprocess (set `CLAUDE_PLUGIN_ROOT` or `PLUGIN_ROOT` so the path resolves).
