#!/usr/bin/env node
import {
  antigravityAdapter
} from "../chunk-LRHTS7LG.js";
import {
  MAX_STOP_REMINDERS,
  formatStopReminderMessage,
  incrementLatchRemindedCount,
  listLatches,
  peekPromptGroup,
  readLatchRecord,
  sweepLatches
} from "../chunk-7T5RZOYH.js";

// hooks/stop.ts
async function main() {
  try {
    for await (const _chunk of process.stdin) {
    }
  } catch {
  }
  sweepLatches();
  const promptGroup = peekPromptGroup();
  const pending = promptGroup ? listLatches().find((l) => !l.expired && l.group === promptGroup) : void 0;
  const rec = pending && readLatchRecord(pending.group, pending.resource, pending.action);
  if (rec && (rec.remindedCount ?? 0) < MAX_STOP_REMINDERS) {
    process.stdout.write(
      antigravityAdapter.emitStop(formatStopReminderMessage(rec))
    );
    incrementLatchRemindedCount(rec.group, rec.resource, rec.action);
  }
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}
`);
  process.exit(0);
});
