#!/usr/bin/env node
/**
 * Cursor PreToolUse hook — shared entry for beforeShellExecution and
 * beforeMCPExecution.
 *
 * Wire format diverges from Claude Code: stdout is FLAT
 * `{ permission: "allow"|"deny", user_message?, agent_message?, updated_input? }`
 * with no `hookSpecificOutput` wrapper. The cursorAdapter renders this;
 * everything else (stdin parse, gate evaluation, side-effect ordering)
 * mirrors the Claude Code / Codex entrypoint verbatim.
 *
 * Cursor's stdin already uses snake_case (`tool_name`, `tool_input`, `cwd`),
 * matching Claude Code, so parsing delegates to claudeCodeAdapter through
 * cursorAdapter. The classifier in stepup-core accepts `Shell` (Cursor) in
 * addition to `Bash` / `run_command`.
 */
import "../host.js";
