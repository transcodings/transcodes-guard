# Step-up MFA protocol (auto-loaded by Antigravity)

Antigravity scans every plugin's `rules/` directory and loads matching markdown into the agent's working context. This file is the static protocol primer the agent needs whenever a `PreToolUse` hook denies a `run_command` (shell) or MCP tool call with `decision: "deny"` and a reason mentioning Step-up MFA.

Open source: [transcodes-guard](https://github.com/transcodings/transcodes-guard)

## Step-up MFA protocol

When a PreToolUse hook denies with Step-up MFA, the command was **BLOCKED and did NOT execute**. Drive the loop deterministically — **do NOT wait for user confirmation before calling the wait tool**:

1. Tell the user (one short line) to complete WebAuthn in the opened tab (paste the URL from the deny message if it did not open).
2. Immediately call MCP tool `tc_poll_stepup_session_wait` with the sid. It blocks until verified or 60s timeout.
3. **verified** → retry the **same** blocked shell or MCP call.
   **timeout**, **rejected**, or **not_found** → tell the user (one short line) this command did not run; **skip the blocked command**; **continue other work**.
   Do NOT re-poll, reopen auth tabs, or retry the SAME blocked command unless the user explicitly asks to authenticate again.
   Do not invent an alternate command that works around the blocked action.

**Never** assume the blocked command ran. Always resume from the pending sid the hook reported when driving the wait loop.

## Diagnostics

When step-up state looks inconsistent (e.g. the hook keeps denying after you think it should allow), call the MCP tool `tc_inspect_stepup_state` for a read-only structured snapshot of the `verified` / `pending` / `browser_lock` files. Prefer this over wrapping `cat` or `ls` over the cache directory — it returns server-computed `age_ms`, `expired`, and `ttl_ms`.

To simulate a hook invocation end-to-end with state diff, call `tc_simulate_hook_invocation`. It spawns the actual hook binary in a subprocess.
