#!/usr/bin/env node
import {
  antigravityAdapter
} from "../chunk-LRHTS7LG.js";
import {
  GATE_DECISION_KIND,
  formatBlockByPolicyReason,
  formatBlockByPolicySystemMessage,
  formatNoTokenReason,
  formatNoTokenSystemMessage,
  formatStderrTag,
  formatStepupChallengedReason,
  formatStepupChallengedSystemMessage,
  formatStepupCreateFailedReason,
  formatStepupCreateFailedSystemMessage,
  formatStepupRejectedReason,
  formatStepupRejectedSystemMessage,
  getGateBackend
} from "../chunk-I3Q4MMYD.js";

// hooks/pre-tool-use.ts
import { readFileSync } from "fs";
async function main() {
  const raw = readFileSync(0, "utf8");
  const input = antigravityAdapter.parsePreToolUseStdin(raw);
  const backend = getGateBackend();
  const decision = await backend.evaluatePreToolUse(input);
  switch (decision.kind) {
    case GATE_DECISION_KIND.PROCEED_UNGATED:
    case GATE_DECISION_KIND.PROCEED_BY_POLICY:
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_NO_TOKEN:
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
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
        antigravityAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatBlockByPolicyReason(decision),
          systemMessage: formatBlockByPolicySystemMessage(decision)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED:
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupCreateFailedReason(decision),
          systemMessage: formatStepupCreateFailedSystemMessage(decision)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED:
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupChallengedReason(decision),
          systemMessage: formatStepupChallengedSystemMessage(decision)
        })
      );
      process.stderr.write(`${formatStderrTag(decision)}
`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
    case GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED:
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
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
