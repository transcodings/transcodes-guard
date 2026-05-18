#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook — danger command interceptor.
 *
 * Two-layer check on Bash tool invocations:
 *
 *   1. Regex patterns (`danger-patterns.json`) — catches absolute paths,
 *      `$HOME`, `dd`, `mkfs`, `curl|bash`, fork bombs, force-pushes, etc.
 *   2. Git semantic check on `rm -rf <target>` — resolves each target
 *      relative to the session `cwd` and blocks if any target contains
 *      files tracked by git, regardless of whether the target was given
 *      as an absolute or a relative path. This catches the relative-path
 *      gap that pure regex misses (e.g. `rm -rf src`).
 *
 * On danger match: agent-driven step-up MFA loop.
 *   a. If the cross-platform store already holds a verified record (a
 *      previous step-up that has not been consumed yet), consume it and
 *      exit 0 — the command runs.
 *   b. Otherwise call `requestStepup`: create a Transcodes step-up
 *      session, auto-launch the browser to the WebAuthn URL, write the
 *      pending state file for the secondary hooks, and emit a v2 hook
 *      response that denies the call with `permissionDecision: "deny"`
 *      plus a `systemMessage` that names the URL + sid and instructs
 *      the agent to poll via the `poll_stepup_session` MCP tool and
 *      retry the same Bash command. The retry hits branch (a) and
 *      falls through.
 *
 * Output channel choice: v2 stdout JSON with `permissionDecision`
 * supersedes the exit 2 + stderr text variant. The structured form
 * gets injected into model context as a first-class signal instead of
 * being parsed out of an "error" stream. exit code stays 0 in both
 * allow and deny paths.
 *
 * Why the hook does not poll: every connected agent (any user, any
 * session) needs visibility into the step-up flow as it happens. A 50 s
 * blocking poll inside the hook leaves the agent unable to relay
 * status to the user. Splitting into "create + handoff" (this hook)
 * and "poll" (MCP tool, agent-driven) makes the flow observable
 * everywhere.
 *
 * Fail policy is asymmetric:
 *  - Before a danger match (JSON parse, pattern load): **fail-open** —
 *    a buggy guard must not brick the workflow.
 *  - After a danger match (step-up create/network): **fail-safe** —
 *    if we cannot prove the user authorised the command, we deny.
 */
export {};
