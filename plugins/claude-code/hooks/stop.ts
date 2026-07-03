#!/usr/bin/env node
/**
 * Claude Code Stop hook — catches a dangling step-up loop + reaps orphans.
 *
 * Orphan cleanup rules (silent — no reminder JSON):
 *   - verified record exists + pending gone or status != "pending"
 *   - pending says "verified" + verified file gone
 *
 * Otherwise, if a real pending record is in flight, emit a top-level
 * `{ decision: "block", reason }` reminder. Stop is excluded from the
 * `hookSpecificOutput` enum — wrapping it makes the validator reject.
 */
import '../host.js';
import '../backend.js';
import {
  getGateBackend,
  type PendingState,
} from '@transcodes-guard/gate-contract';
import { claudeCodeAdapter } from '@transcodes-guard/hook-adapters';

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
  // Drain stdin even though we don't read it; some hosts require it.
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }

  const backend = getGateBackend();

  // Silent housekeeping for the FP-KEYED (Bash + user tool-rule) files:
  // reap orphans + sweep expired. GLOBAL (MCP system) orphan reap stays
  // inline below for backward-compatible behaviour.
  backend.sweepStepup();

  const pending = backend.readPending();
  const verified = backend.readVerified();

  // Orphan A: GLOBAL verified file exists but pending is gone or non-pending.
  if (verified && pending?.status !== 'pending') {
    backend.consumeVerified();
    if (pending) backend.clearPending();
    process.exit(0);
  }
  // Orphan B: GLOBAL pending says verified but the verified file is gone.
  if (pending && !verified && pending.status === 'verified') {
    backend.clearPending();
    process.exit(0);
  }

  // Remind on the first in-flight session: GLOBAL first (unchanged), else
  // any FP-KEYED Bash/user session still awaiting verification.
  const reminder =
    pending && !backend.isExpired(pending)
      ? pending
      : backend.firstInFlightFpPending();
  if (!reminder) process.exit(0);
  const shown = reminder.remindedCount ?? 0;
  if (shown >= MAX_STOP_REMINDERS) process.exit(0);

  process.stdout.write(claudeCodeAdapter.emitStop(reminderFor(reminder)));
  // Side effect only after the decision is on stdout (fail-safe order).
  backend.writePending({ ...reminder, remindedCount: shown + 1 });
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}\n`);
  process.exit(0);
});
