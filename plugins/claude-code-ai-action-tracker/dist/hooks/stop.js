#!/usr/bin/env node
import {
  claudeCodeAdapter
} from "../chunk-ODK4KW7V.js";
import {
  clearPending,
  consumeVerified,
  firstInFlightFpPending,
  isExpired,
  readPending,
  readVerified,
  sweepStepup
} from "../chunk-Z4JI3X77.js";

// hooks/stop.ts
function reminderFor(pending) {
  return [
    "transcodes-guard: a step-up MFA session is still PENDING. The Bash",
    "command it gated was NOT executed. Resume the loop or report to the",
    "user that authentication is still required.",
    "",
    `Session sid     : ${pending.sid}`,
    `Original command: ${pending.command}`,
    `Browser URL     : ${pending.browserUrl}`,
    "",
    "Next action:",
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original Bash command.'
  ].join("\n");
}
async function main() {
  try {
    for await (const _chunk of process.stdin) {
    }
  } catch {
  }
  sweepStepup();
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
  const reminder = pending && !isExpired(pending) ? pending : firstInFlightFpPending();
  if (!reminder) process.exit(0);
  process.stdout.write(claudeCodeAdapter.emitStop(reminderFor(reminder)));
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}
`);
  process.exit(0);
});
