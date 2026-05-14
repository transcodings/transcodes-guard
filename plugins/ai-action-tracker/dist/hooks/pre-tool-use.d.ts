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
 * On danger match: runs the Step-up MFA gate (`src/stepup/gate.ts`) —
 * opens a Transcodes step-up session, prints the browser URL to stderr,
 * polls the backend for up to 60s, and only exits 0 if the backend
 * reports `verified`. Otherwise emits the BLOCKED message and exits 2.
 *
 * Fail policy is asymmetric:
 *  - Before a danger match (JSON parse, pattern load): **fail-open** —
 *    a buggy guard must not brick the workflow.
 *  - After a danger match (step-up create/poll/network): **fail-safe** —
 *    if we cannot prove the user authorised the command, we block it.
 */
export {};
