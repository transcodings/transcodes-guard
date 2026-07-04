#!/usr/bin/env node
import {
  antigravityAdapter
} from "../chunk-HBLMEC7F.js";
import {
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-UZG3CVR5.js";

// hooks/pre-invocation.ts
import { readFileSync } from "fs";
function primerMessage() {
  return [
    "transcodes-guard step-up MFA protocol primer:",
    "",
    "When a PreToolUse hook denies a shell or MCP tool call with reason",
    "mentioning Step-up MFA, the command was BLOCKED and did NOT execute.",
    "Drive the loop deterministically \u2014 do NOT wait for user confirmation",
    "between steps:",
    "  1. Tell the user (one short line) to complete WebAuthn in the",
    "     auto-opened browser tab (paste the URL from the deny message if",
    "     it did not open).",
    "  2. Immediately call MCP tool `tc_poll_stepup_session_wait` with the sid",
    "     from the deny message. It blocks until verified or 60s timeout.",
    '  3. On `outcome: "verified"` retry the same command \u2014 the backend cache',
    "     reports it verified and the gate allows it.",
    '  4. On `outcome: "timeout"` ask the user to retry WebAuthn, then call',
    "     the wait tool again.",
    "",
    "Never assume the blocked command ran. Never invent an alternative",
    "command. Always resume from the sid the hook reported."
  ].join("\n");
}
async function main() {
  if (!antigravityAdapter.parsePreInvocationStdin || !antigravityAdapter.emitPreInvocation) {
    process.exit(0);
  }
  const raw = readFileSync(0, "utf8");
  let input;
  try {
    input = antigravityAdapter.parsePreInvocationStdin(raw);
  } catch {
    process.exit(0);
  }
  const backend = getGateBackend();
  const injectSteps = [];
  if (input.invocationNum <= 1) {
    injectSteps.push({ ephemeralMessage: primerMessage() });
    if (!backend.hasToken()) {
      injectSteps.push({ ephemeralMessage: formatNoTokenSessionNotice() });
    }
  }
  process.stdout.write(antigravityAdapter.emitPreInvocation(injectSteps));
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard pre-invocation hook error: ${err}
`);
  process.exit(0);
});
