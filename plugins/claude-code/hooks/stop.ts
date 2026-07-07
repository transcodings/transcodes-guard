#!/usr/bin/env node
/**
 * Claude Code Stop hook — expired latch reap + capped MFA reminder.
 */
import '../host.js';
import '../backend.js';
import { claudeCodeAdapter } from '@transcodes-guard/core/hosts';
import {
  formatStopReminderMessage,
  incrementLatchRemindedCount,
  listLatches,
  MAX_STOP_REMINDERS,
  peekPromptGroup,
  readLatchRecord,
  sweepLatches,
} from '@transcodes-guard/core/stepup';

async function main(): Promise<void> {
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }

  sweepLatches();

  const promptGroup = peekPromptGroup();
  const pending = promptGroup
    ? listLatches().find((l) => !l.expired && l.group === promptGroup)
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
