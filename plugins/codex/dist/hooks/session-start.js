#!/usr/bin/env node
import {
  codexAdapter
} from "../chunk-RAMWXODQ.js";
import {
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-QDWESYNR.js";

// hooks/session-start.ts
function carryoverBlock() {
  const pending = getGateBackend().firstActivePending();
  if (!pending) return null;
  const statusNote = pending.status === "verified" ? "VERIFIED but not yet consumed \u2014 retry the original command to release it." : "PENDING \u2014 resume polling.";
  return [
    "Carried-over step-up state from a previous session:",
    `  sid     : ${pending.sid}`,
    `  status  : ${pending.status} (${statusNote})`,
    `  command : ${pending.command}`,
    `  reason  : ${pending.reason}`,
    `  url     : ${pending.browserUrl}`
  ].join("\n");
}
async function main() {
  const tokenNotice = getGateBackend().hasToken() ? null : formatNoTokenSessionNotice();
  const parts = [carryoverBlock(), tokenNotice].filter(
    (s) => Boolean(s)
  );
  if (parts.length > 0) {
    process.stdout.write(
      codexAdapter.emitSessionStartContext(parts.join("\n"))
    );
  }
  await getGateBackend().refreshPolicyBundle();
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}
`);
  process.exit(0);
});
