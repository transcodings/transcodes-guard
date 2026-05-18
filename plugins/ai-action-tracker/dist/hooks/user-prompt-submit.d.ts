#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — bridges user → agent for the
 * step-up MFA loop.
 *
 * When the user types something like "인증 완료", "done", or "auth
 * passed" while a pending step-up session is in flight, the agent
 * cannot otherwise know which sid that ack refers to. This hook reads
 * the shared pending state and injects an `additionalContext` block
 * that names the sid, the original Bash command, and the next action
 * (call `poll_stepup_session`).
 *
 * The hook never blocks the prompt. Any error path is a no-op.
 */
export {};
