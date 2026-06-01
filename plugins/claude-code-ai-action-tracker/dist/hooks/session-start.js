#!/usr/bin/env node
import {
  claudeCodeAdapter
} from "../chunk-RNXEHGBK.js";
import {
  formatNoTokenSessionNotice,
  isExpired,
  isTrackerEnabled,
  readPending,
  resolveToken
} from "../chunk-3J7XK5DB.js";

// hooks/session-start.ts
var PROTOCOL_PRIMER = [
  "transcodes-guard step-up MFA protocol:",
  "",
  'When a PreToolUse hook denies a Bash with `permissionDecision: "deny"`',
  "and the reason mentions Step-up MFA, the command was BLOCKED and",
  "did NOT execute. Drive the loop deterministically \u2014 DO NOT wait for",
  "user confirmation between steps:",
  "",
  "  1. Tell the user (one short line) to complete WebAuthn in the",
  "     auto-opened browser tab (use the URL from the deny message",
  "     if it did not open).",
  "  2. Immediately call the MCP tool `poll_stepup_session_wait` with the",
  "     provided sid. It blocks until verified or 60s timeout \u2014 a single",
  "     call replaces the manual polling loop. (The legacy single-shot",
  "     `poll_stepup_session` is only for diagnostics.)",
  '  3. On `outcome: "verified"` retry the SAME Bash command \u2014 the hook',
  "     detects the verified state locally and allows it. On `outcome:",
  '     "timeout"` ask the user to retry WebAuthn, then call the wait',
  "     tool again.",
  "",
  "Never assume the blocked command ran. Never invent an alternative",
  "command. Always resume from the pending sid the hook reported."
].join("\n");
function carryoverBlock() {
  const pending = readPending();
  if (!pending) return null;
  if (isExpired(pending)) return null;
  const statusNote = pending.status === "verified" ? "VERIFIED but not yet consumed \u2014 retry the original command to release it." : "PENDING \u2014 resume polling.";
  return [
    "",
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
  const carry = carryoverBlock();
  const tokenNotice = resolveToken().token ? null : formatNoTokenSessionNotice();
  const additionalContext = [PROTOCOL_PRIMER, carry, tokenNotice].filter((s) => Boolean(s)).join("\n");
  process.stdout.write(claudeCodeAdapter.emitSessionStartContext(additionalContext));
  process.exit(0);
}
try {
  main();
} catch (err) {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}
`);
  process.exit(0);
}
