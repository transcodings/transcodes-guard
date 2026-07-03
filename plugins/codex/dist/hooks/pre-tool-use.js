#!/usr/bin/env node
import {
  codexAdapter
} from "../chunk-DRZMA5IG.js";
import {
  GATE_DECISION_KIND,
  formatNoTokenReason,
  formatNoTokenSystemMessage,
  formatRbacDeniedReason,
  formatRbacDeniedSystemMessage,
  formatStderrTag,
  formatStepupFailureReason,
  formatStepupFailureSystemMessage,
  formatStepupPendingReason,
  formatStepupPendingSystemMessage,
  formatStepupRejectedReason,
  formatStepupRejectedSystemMessage,
  getGateBackend
} from "../chunk-IFLTXULD.js";

// hooks/pre-tool-use.ts
import { readFileSync } from "fs";
async function main() {
  const raw = readFileSync(0, "utf8");
  const input = codexAdapter.parsePreToolUseStdin(raw);
  const backend = getGateBackend();
  const decision = await backend.evaluatePreToolUse(input);
  switch (decision.kind) {
    case GATE_DECISION_KIND.PROCEED_UNGATED:
    case GATE_DECISION_KIND.PROCEED_BY_POLICY:
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_NO_TOKEN:
      process.stdout.write(
        codexAdapter.emitPreToolUse({
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
        codexAdapter.emitPreToolUse({
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
        codexAdapter.emitPreToolUse({
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
        codexAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupPendingReason(decision),
          systemMessage: formatStepupPendingSystemMessage(decision)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED:
      process.stdout.write(
        codexAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupRejectedReason(decision),
          systemMessage: formatStepupRejectedSystemMessage(decision)
        })
      );
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
