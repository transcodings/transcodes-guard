# transcodes-guard — Codex CLI agent guidance

Codex reads this file at the start of every turn (per [`AGENTS.md` spec](https://developers.openai.com/codex/guides/agents-md)). It contains the static step-up MFA protocol primer the agent needs whenever a PreToolUse hook denies a Bash or MCP call.

Open source: [transcodes-guard](https://github.com/transcodings/transcodes-guard)

## Step-up MFA protocol

When a PreToolUse hook denies with Step-up MFA, the command was **BLOCKED and did NOT execute**. Drive the loop deterministically — **do NOT wait for user confirmation before calling the wait tool**:

1. Tell the user (one short line) to complete WebAuthn in the opened tab (paste the URL from the deny message if it did not open).
2. Immediately call MCP tool `tc_poll_stepup_session_wait` with the sid. Waits up to ~5 min (session TTL) until verified or timeout.
3. **verified** → retry the **same** blocked Bash or MCP call.
   **timeout**, **rejected**, or **not_found** → tell the user (one short line) this command did not run; **skip the blocked command**; **continue other work**.
   Do NOT re-poll, reopen auth tabs, or retry the SAME blocked command unless the user explicitly asks to authenticate again.
   Do not invent an alternate command that works around the blocked action.
4. If the user says **stop** / **cancel** / **skip** at any time, abort this command and continue other work — do not keep waiting.

**Never** assume the blocked command ran. Always resume from the pending sid the hook reported when driving the wait loop.

## Diagnostics

When step-up state looks inconsistent (e.g. the hook keeps denying after you think it should allow), call the MCP tool `tc_inspect_stepup_state` for a read-only structured snapshot of the `verified` / `pending` / `browser_lock` files. Prefer this over wrapping `cat` or `ls` over the cache directory — it returns server-computed `age_ms`, `expired`, and `ttl_ms`.

To simulate a hook invocation end-to-end with state diff, call `tc_simulate_hook_invocation`. It spawns the actual hook binary in a subprocess (set `CLAUDE_PLUGIN_ROOT` or `PLUGIN_ROOT` so the path resolves).
