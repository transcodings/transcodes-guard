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
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';
import { getGateBackend } from '@transcodes-guard/gate-contract';
import {
  COMPLETION_PATTERN,
  cursorAdapter,
} from '@transcodes-guard/hook-adapters';

function emitContinue(): never {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

function main(): void {
  const raw = readFileSync(0, 'utf8');

  let parsed;
  try {
    parsed = cursorAdapter.parseUserPromptSubmitStdin(raw);
  } catch {
    emitContinue();
  }

  if (!parsed.prompt) emitContinue();

  const backend = getGateBackend();

  // A genuine new-task prompt starts a fresh resource/action grouping window;
  // completion prompts ("done") continue the current task and keep the bucket.
  if (!COMPLETION_PATTERN.test(parsed.prompt)) {
    backend.rotatePromptSession();
    emitContinue();
  }

  const pending = backend.firstActivePending();
  if (!pending) emitContinue();

  // User says "done" and a verified record is sitting in the cache → the
  // sensible thing is to consume it so the next danger tool call passes
  // through. `pending.fp` selects the right store: FP-KEYED for Bash/user
  // sessions, GLOBAL (undefined fp) for the MCP system path. If verified is
  // missing, the agent is expected to call poll_stepup_session_wait via MCP.
  if (backend.readVerified(pending.fp)) {
    backend.consumeVerified(pending.fp);
    backend.clearPending(pending.fp);
  }

  emitContinue();
}

try {
  main();
} catch (err) {
  process.stderr.write(
    `transcodes-guard before-submit-prompt hook error: ${err}\n`,
  );
  emitContinue();
}
