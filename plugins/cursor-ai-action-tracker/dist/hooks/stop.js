#!/usr/bin/env node
import {
  cursorAdapter
} from "../chunk-J6QNXIGR.js";
import {
  clearPending,
  consumeVerified,
  isExpired,
  readPending,
  readVerified
} from "../chunk-2IJSD757.js";

// hooks/stop.ts
function reminderFor(pending) {
  return [
    "ai-action-tracker: a step-up MFA session is still PENDING. The Shell",
    "command it gated was NOT executed. Resume the loop or report to the",
    "user that authentication is still required.",
    "",
    `Session sid     : ${pending.sid}`,
    `Original command: ${pending.command}`,
    `Browser URL     : ${pending.browserUrl}`,
    "",
    "Next action:",
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original Shell command.'
  ].join("\n");
}
async function main() {
  try {
    for await (const _chunk of process.stdin) {
    }
  } catch {
  }
  const pending = readPending();
  const verified = readVerified();
  if (verified && (!pending || pending.status !== "pending")) {
    consumeVerified();
    if (pending) clearPending();
    process.exit(0);
  }
  if (pending && !verified && pending.status === "verified") {
    clearPending();
    process.exit(0);
  }
  if (!pending || isExpired(pending)) process.exit(0);
  process.stdout.write(cursorAdapter.emitStop(reminderFor(pending)));
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`ai-action-tracker stop hook error: ${err}
`);
  process.exit(0);
});
