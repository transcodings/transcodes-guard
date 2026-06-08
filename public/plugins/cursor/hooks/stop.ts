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

function reminderFor(pending: PendingState): string {
  return [
    'transcodes-guard: a step-up MFA session is still PENDING. The Shell',
    'command it gated was NOT executed. Resume the loop or report to the',
    'user that authentication is still required.',
    '',
    `Session sid     : ${pending.sid}`,
    `Original command: ${pending.command}`,
    `Browser URL     : ${pending.browserUrl}`,
    '',
    'Next action:',
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original Shell command.',
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

  if (verified && (!pending || pending.status !== 'pending')) {
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

  process.stdout.write(cursorAdapter.emitStop(reminderFor(reminder)));
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}\n`);
  process.exit(0);
});
