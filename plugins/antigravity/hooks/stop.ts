#!/usr/bin/env node
/**
 * Antigravity 2.0 Stop hook — expired latch reap + capped MFA reminder.
 */
import '../host.js';
import '../backend.js';
import { antigravityAdapter } from '@transcodes-guard/hook-adapters';
import {
  formatStopReminderMessage,
  incrementLatchRemindedCount,
  listLatches,
  MAX_STOP_REMINDERS,
  peekPromptSid,
  readLatchRecord,
  sweepLatches,
} from '@transcodes-guard/stepup-core';

async function main(): Promise<void> {
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }

  sweepLatches();

  const promptSid = peekPromptSid();
  const pending = promptSid
    ? listLatches().find((l) => !l.expired && l.sid === promptSid)
    : undefined;
  const rec =
    pending && readLatchRecord(pending.sid, pending.resource, pending.action);
  if (rec && (rec.remindedCount ?? 0) < MAX_STOP_REMINDERS) {
    process.stdout.write(
      antigravityAdapter.emitStop(formatStopReminderMessage(rec)),
    );
    incrementLatchRemindedCount(rec.sid, rec.resource, rec.action);
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}\n`);
  process.exit(0);
});
