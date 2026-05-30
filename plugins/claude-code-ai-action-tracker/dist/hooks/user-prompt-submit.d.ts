#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — bridge user → agent for step-up.
 *
 * When the user types something like "완료", "done", or "auth passed" while
 * a pending step-up session is in flight, this hook injects a context block
 * naming the sid + next action so the agent knows which session to poll.
 */
import "../host.js";
