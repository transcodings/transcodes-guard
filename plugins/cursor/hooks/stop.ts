#!/usr/bin/env node
/**
 * Cursor stop hook — dangling step-up reminder + orphan reap.
 *
 * Cursor's stop output is `{ followup_message? }` — semantically identical
 * to Claude Code's `{ decision: "block", reason }` (instructs the model on
 * the next turn) but uses a different key name. The cursorAdapter handles
 * the rendering; the rest of the body mirrors the codex stop entry.
 */
import '../host.js';
import '../backend.js';
import {
  getGateBackend,
  type PendingState,
} from '@transcodes-guard/gate-contract';
import { cursorAdapter } from '@transcodes-guard/hook-adapters';

/** Cap the Stop block-loop: after this many reminders for the same pending
 * record, let the turn end instead of holding the session hostage until the
 * backend TTL (the user may have chosen not to authenticate). */
const MAX_STOP_REMINDERS = 3;

function reminderFor(pending: PendingState): string {
  return [
    'transcodes-guard: a step-up MFA session is still PENDING. The tool',
    'call it gated was NOT executed. Resume the loop or report to the',
    'user that authentication is still required.',
    '',
    `Session sid     : ${pending.sid}`,
    `Original command: ${pending.command}`,
    `Browser URL     : ${pending.browserUrl}`,
    '',
    'Next action:',
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original tool call.',
  ].join('\n');
}

async function main(): Promise<void> {
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }

  const backend = getGateBackend();
  backend.sweepStepup();

  const pending = backend.readPending();
  const verified = backend.readVerified();

  if (verified && pending?.status !== 'pending') {
    backend.consumeVerified();
    if (pending) backend.clearPending();
    process.exit(0);
  }
  if (pending && !verified && pending.status === 'verified') {
    backend.clearPending();
    process.exit(0);
  }

  const reminder =
    pending && !backend.isExpired(pending)
      ? pending
      : backend.firstInFlightFpPending();
  if (!reminder) process.exit(0);
  const shown = reminder.remindedCount ?? 0;
  if (shown >= MAX_STOP_REMINDERS) process.exit(0);

  process.stdout.write(cursorAdapter.emitStop(reminderFor(reminder)));
  // Side effect only after the decision is on stdout (fail-safe order).
  backend.writePending({ ...reminder, remindedCount: shown + 1 });
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}\n`);
  process.exit(0);
});
