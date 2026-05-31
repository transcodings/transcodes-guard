#!/usr/bin/env node
import {
  cursorAdapter
} from "../chunk-J6QNXIGR.js";
import {
  formatNoTokenSessionNotice,
  isExpired,
  isTrackerEnabled,
  readPending,
  resolveToken
} from "../chunk-53XLFTXI.js";

// hooks/session-start.ts
function carryoverBlock() {
  const pending = readPending();
  if (!pending) return null;
  if (isExpired(pending)) return null;
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
function main() {
  if (!isTrackerEnabled()) process.exit(0);
  const tokenNotice = resolveToken().token ? null : formatNoTokenSessionNotice();
  const parts = [carryoverBlock(), tokenNotice].filter(
    (s) => Boolean(s)
  );
  if (parts.length === 0) process.exit(0);
  process.stdout.write(cursorAdapter.emitSessionStartContext(parts.join("\n")));
  process.exit(0);
}
try {
  main();
} catch (err) {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}
`);
  process.exit(0);
}
