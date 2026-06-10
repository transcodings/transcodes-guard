#!/usr/bin/env node
import {
  cursorAdapter
} from "../chunk-JLIPJGWI.js";
import {
  formatAllowReason,
  formatNoTokenReason,
  formatNoTokenSystemMessage,
  formatRbacDeniedReason,
  formatRbacDeniedSystemMessage,
  formatStderrTag,
  formatStepupFailureReason,
  formatStepupFailureSystemMessage,
  formatStepupPendingReason,
  formatStepupPendingSystemMessage,
  getGateBackend
} from "../chunk-2QBJUPWC.js";

// hooks/pre-tool-use.ts
import { readFileSync } from "fs";
async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try {
    input = cursorAdapter.parsePreToolUseStdin(raw);
  } catch {
    process.exit(0);
  }
  const backend = getGateBackend();
  const decision = await backend.evaluatePreToolUse(input);
  switch (decision.kind) {
    case "pass":
      process.exit(0);
    case "allow":
      process.stdout.write(
        cursorAdapter.emitPreToolUse({
          kind: "allow",
          reason: formatAllowReason(decision)
        })
      );
      if (decision.consumeHere) {
        backend.consumeVerified(decision.fp);
        backend.clearPending(decision.fp);
      }
      process.stderr.write(`${formatStderrTag(decision)}
`);
      process.exit(0);
    case "deny-no-token":
      process.stdout.write(
        cursorAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatNoTokenReason(decision.block),
          systemMessage: formatNoTokenSystemMessage(decision.block)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      process.exit(0);
    case "deny-rbac-denied":
      process.stdout.write(
        cursorAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatRbacDeniedReason(decision),
          systemMessage: formatRbacDeniedSystemMessage(decision)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      process.exit(0);
    case "deny-stepup-failure":
      process.stdout.write(
        cursorAdapter.emitPreToolUse({
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
        cursorAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupPendingReason(decision),
          systemMessage: formatStepupPendingSystemMessage(decision)
        })
      );
      try {
        backend.writePending(decision.pending);
      } catch (err) {
        process.stderr.write(
          `transcodes-guard: pending file write failed (deny still emitted): ${err}
`
        );
      }
      process.stderr.write(`${formatStderrTag(decision)}
`);
      process.exit(0);
  }
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard hook error: ${err}
`);
  process.exit(0);
});
