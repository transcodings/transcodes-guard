#!/usr/bin/env node
import {
  antigravityAdapter
} from "../chunk-DVNHC35J.js";
import {
  getGateBackend
} from "../chunk-PI7RYBAE.js";

// hooks/stop.ts
function reminderFor(pending) {
  return [
    "transcodes-guard: a step-up MFA session is still PENDING. The shell",
    "command it gated was NOT executed. Resume the loop or report to the",
    "user that authentication is still required.",
    "",
    `Session sid     : ${pending.sid}`,
    `Original command: ${pending.command}`,
    `Browser URL     : ${pending.browserUrl}`,
    "",
    "Next action:",
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original command.'
  ].join("\n");
}
async function main() {
  try {
    for await (const _chunk of process.stdin) {
    }
  } catch {
  }
  const backend = getGateBackend();
  backend.sweepStepup();
  const pending = backend.readPending();
  const verified = backend.readVerified();
  if (verified && (!pending || pending.status !== "pending")) {
    backend.consumeVerified();
    if (pending) backend.clearPending();
    process.exit(0);
  }
  if (pending && !verified && pending.status === "verified") {
    backend.clearPending();
    process.exit(0);
  }
  const reminder = pending && !backend.isExpired(pending) ? pending : backend.firstInFlightFpPending();
  if (!reminder) process.exit(0);
  process.stdout.write(antigravityAdapter.emitStop(reminderFor(reminder)));
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}
`);
  process.exit(0);
});
