#!/usr/bin/env node
import {
  antigravityAdapter,
  detectUserDoneFromTranscript
} from "../chunk-OWLYJFX2.js";
import {
  formatNoTokenSessionNotice,
  getGateBackend
} from "../chunk-THK37QIM.js";

// hooks/pre-invocation.ts
import { readFileSync } from "fs";
function primerMessage(pending) {
  const base = [
    "transcodes-guard step-up MFA protocol primer:",
    "",
    "When a PreToolUse hook denies a shell or MCP tool call with reason",
    "mentioning Step-up MFA, the command was BLOCKED and did NOT execute.",
    "Drive the loop deterministically \u2014 do NOT wait for user confirmation",
    "between steps:",
    "  1. Tell the user (one short line) to complete WebAuthn in the",
    "     auto-opened browser tab (paste the URL from the deny message if",
    "     it did not open).",
    "  2. Immediately call MCP tool `poll_stepup_session_wait` with the sid",
    "     from the deny message. It blocks until verified or 60s timeout.",
    '  3. On `outcome: "verified"` retry the same command \u2014 the hook detects',
    "     the verified state and allows it.",
    '  4. On `outcome: "timeout"` ask the user to retry WebAuthn, then call',
    "     the wait tool again.",
    "",
    "Never assume the blocked command ran. Never invent an alternative",
    "command. Always resume from the pending sid the hook reported."
  ];
  if (pending) {
    base.push(
      "",
      "Carried-over step-up state from a previous turn:",
      `  sid     : ${pending.sid}`,
      `  status  : ${pending.status}`,
      `  command : ${pending.command}`,
      `  url     : ${pending.browserUrl}`
    );
  }
  return base.join("\n");
}
function userDoneNotice(pending, matchedContent) {
  const trimmed = matchedContent.length > 80 ? `${matchedContent.slice(0, 77)}...` : matchedContent;
  const statusNote = pending.status === "verified" ? "already verified \u2014 just retry the original command." : "still pending \u2014 call poll_stepup_session_wait now to block until verified.";
  return [
    `transcodes-guard: user message matched completion pattern ("${trimmed}").`,
    "",
    `Pending session sid : ${pending.sid}`,
    `Status              : ${pending.status} (${statusNote})`,
    `Original command    : ${pending.command}`,
    "",
    "Next action:",
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original command above.'
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
  const pending = backend.firstActivePending();
  const injectSteps = [];
  if (input.invocationNum <= 1) {
    injectSteps.push({ ephemeralMessage: primerMessage(pending) });
    if (!backend.hasToken()) {
      injectSteps.push({ ephemeralMessage: formatNoTokenSessionNotice() });
    }
  }
  if (pending) {
    const matched = detectUserDoneFromTranscript(input.transcriptPath);
    if (matched) {
      injectSteps.push({
        ephemeralMessage: userDoneNotice(pending, matched)
      });
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
