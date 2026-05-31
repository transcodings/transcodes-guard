#!/usr/bin/env node
/**
 * Cursor beforeSubmitPrompt hook — user "auth done" detection without a
 * context channel.
 *
 * Cursor's beforeSubmitPrompt output is `{ continue, user_message? }` only —
 * there is NO `additional_context` channel. So unlike the Claude Code /
 * Codex UserPromptSubmit hooks, this entry cannot push a sid + next-action
 * block to the agent. Instead it performs side effects directly: if the
 * prompt matches the "auth done" pattern AND a verified record exists, it
 * consumes the verified record + clears pending so the next tool call
 * fast-paths through the gate.
 *
 * Output is always `{ continue: true }` (never blocks user input).
 */
import "../host.js";
