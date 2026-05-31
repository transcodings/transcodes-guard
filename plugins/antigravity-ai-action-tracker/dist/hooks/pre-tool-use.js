#!/usr/bin/env node
import {
  antigravityAdapter
} from "../chunk-DVNHC35J.js";
import {
  clearPending,
  consumeVerified,
  evaluatePreToolUse,
  formatAllowReason,
  formatNoTokenReason,
  formatNoTokenSystemMessage,
  formatStderrTag,
  formatStepupFailureReason,
  formatStepupFailureSystemMessage,
  formatStepupPendingReason,
  formatStepupPendingSystemMessage,
  writePending
} from "../chunk-IJ2J6DI7.js";

// hooks/pre-tool-use.ts
import { readFileSync } from "fs";
async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try {
    input = antigravityAdapter.parsePreToolUseStdin(raw);
  } catch {
    process.exit(0);
  }
  const decision = await evaluatePreToolUse(input);
  switch (decision.kind) {
    case "pass":
      process.exit(0);
    case "allow":
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "allow",
          reason: formatAllowReason(decision)
        })
      );
      if (decision.consumeHere) {
        consumeVerified();
        clearPending();
      }
      process.stderr.write(`${formatStderrTag(decision)}
`);
      process.exit(0);
    case "deny-no-token":
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatNoTokenReason(decision.block),
          systemMessage: formatNoTokenSystemMessage(decision.block)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      process.exit(0);
    case "deny-stepup-failure":
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupFailureReason(decision),
          systemMessage: formatStepupFailureSystemMessage(decision)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      process.exit(0);
    case "deny-stepup-pending":
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupPendingReason(decision),
          systemMessage: formatStepupPendingSystemMessage(decision)
        })
      );
      try {
        writePending(decision.pending);
      } catch (err) {
        process.stderr.write(
          `ai-action-tracker: pending file write failed (deny still emitted): ${err}
`
        );
      }
      process.stderr.write(`${formatStderrTag(decision)}
`);
      process.exit(0);
  }
}
main().catch((err) => {
  process.stderr.write(`ai-action-tracker hook error: ${err}
`);
  process.exit(0);
});
