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
 * On block: writes a structured warning to stderr explaining the reason
 * and exits with code 2. Claude Code feeds stderr back to the LLM and
 * surfaces it in the chat transcript.
 *
 * Failures (malformed input, missing config, hook bugs) fail-open
 * (exit 0) so a buggy guard cannot brick the user's workflow.
 */
export {};
