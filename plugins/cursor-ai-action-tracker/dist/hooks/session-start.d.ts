#!/usr/bin/env node
/**
 * Cursor sessionStart hook — pending carry-over notice.
 *
 * Cursor's sessionStart output is `{ additional_context?, env? }`
 * (snake_case) — semantically identical to Claude Code's
 * `hookSpecificOutput.additionalContext` but flat. Mirror the codex hook
 * body verbatim; only the adapter import differs.
 */
import "../host.js";
