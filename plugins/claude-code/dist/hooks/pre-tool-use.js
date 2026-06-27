#!/usr/bin/env node
import {
  claudeCodeAdapter
} from "../chunk-3CZICWJM.js";
import {
  GATE_DECISION_KIND,
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
} from "../chunk-NFJ5PUQW.js";

// hooks/pre-tool-use.ts
import { readFileSync } from "fs";
async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try {
    input = claudeCodeAdapter.parsePreToolUseStdin(raw);
  } catch {
    process.exit(0);
  }
  const backend = getGateBackend();
  const decision = await backend.evaluatePreToolUse(input);
  switch (decision.kind) {
    case GATE_DECISION_KIND.PROCEED_UNGATED:
    case GATE_DECISION_KIND.PROCEED_BY_POLICY:
      process.exit(0);
    case GATE_DECISION_KIND.PROCEED_BY_VERIFICATION:
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
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
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_NO_TOKEN:
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatNoTokenReason(decision.block),
          systemMessage: formatNoTokenSystemMessage(decision.block)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_BY_POLICY:
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatRbacDeniedReason(decision),
          systemMessage: formatRbacDeniedSystemMessage(decision)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED:
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupFailureReason(decision),
          systemMessage: formatStepupFailureSystemMessage(decision)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED:
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
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
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
  }
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard hook error: ${err}
`);
  process.exit(0);
});
