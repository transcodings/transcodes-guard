#!/usr/bin/env node
import {
  antigravityAdapter
} from "../chunk-HBLMEC7F.js";
import {
  MAX_STOP_REMINDERS,
  formatStopReminderMessage,
  incrementLatchRemindedCount,
  listLatches,
  peekPromptSid,
  readLatchRecord,
  sweepLatches
} from "../chunk-B6CEUN2B.js";

// hooks/stop.ts
async function main() {
  try {
    for await (const _chunk of process.stdin) {
    }
  } catch {
  }
  sweepLatches();
  const promptSid = peekPromptSid();
  const pending = promptSid ? listLatches().find((l) => !l.expired && l.sid === promptSid) : void 0;
  const rec = pending && readLatchRecord(pending.sid, pending.resource, pending.action);
  if (rec && (rec.remindedCount ?? 0) < MAX_STOP_REMINDERS) {
    process.stdout.write(
      antigravityAdapter.emitStop(formatStopReminderMessage(rec))
    );
    incrementLatchRemindedCount(rec.sid, rec.resource, rec.action);
  }
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}
`);
  process.exit(0);
});
