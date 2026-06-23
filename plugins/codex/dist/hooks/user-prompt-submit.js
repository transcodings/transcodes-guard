#!/usr/bin/env node
import {
  COMPLETION_PATTERN,
  codexAdapter
} from "../chunk-RAMWXODQ.js";
import {
  getGateBackend
} from "../chunk-GOMDTWD3.js";

// hooks/user-prompt-submit.ts
import { readFileSync } from "fs";
function buildContext(prompt, pending) {
  if (!COMPLETION_PATTERN.test(prompt)) return null;
  const statusNote = pending.status === "verified" ? "already verified \u2014 just retry the original command." : "still pending \u2014 call poll_stepup_session_wait now to block until verified.";
  return [
    "transcodes-guard: user appears to report step-up MFA completion.",
    "",
    `Pending session sid : ${pending.sid}`,
    `Status              : ${pending.status} (${statusNote})`,
    `Original command    : ${pending.command}`,
    "",
    "Next action:",
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original Bash command above.'
  ].join("\n");
}
function main() {
  const raw = readFileSync(0, "utf8");
  let parsed;
  try {
    parsed = codexAdapter.parseUserPromptSubmitStdin(raw);
  } catch {
    process.exit(0);
  }
  if (!parsed.prompt) process.exit(0);
  const pending = getGateBackend().firstActivePending();
  if (!pending) process.exit(0);
  const additionalContext = buildContext(parsed.prompt, pending);
  if (!additionalContext) process.exit(0);
  process.stdout.write(
    codexAdapter.emitUserPromptSubmitContext(additionalContext)
  );
  process.exit(0);
}
try {
  main();
} catch (err) {
  process.stderr.write(
    `transcodes-guard user-prompt-submit hook error: ${err}
`
  );
  process.exit(0);
}
