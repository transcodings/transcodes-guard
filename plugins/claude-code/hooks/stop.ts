#!/usr/bin/env node
/**
 * Claude Code Stop hook — expired latch reap + capped MFA reminder.
 */
import '../host.js';
import '../backend.js';
import { claudeCodeAdapter } from '@transcodes-guard/hook-adapters';
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
    ? listLatches().find((l) => !l.expired && l.group === promptSid)
    : undefined;
  const rec =
    pending && readLatchRecord(pending.group, pending.resource, pending.action);
  if (rec && (rec.remindedCount ?? 0) < MAX_STOP_REMINDERS) {
    process.stdout.write(
      claudeCodeAdapter.emitStop(formatStopReminderMessage(rec)),
    );
    incrementLatchRemindedCount(rec.group, rec.resource, rec.action);
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}\n`);
  process.exit(0);
});
