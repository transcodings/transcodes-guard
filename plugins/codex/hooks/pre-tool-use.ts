#!/usr/bin/env node
/**
 * Codex CLI PreToolUse hook — thin entrypoint over @transcodes-guard/core/stepup.
 *
 * Mirrors plugins/claude-code/hooks/pre-tool-use.ts; the
 * only divergence is the adapter (codexAdapter). Codex's wire format
 * converged on Claude Code's PreToolUse contract, so the bytes emitted
 * here are byte-for-byte identical — the adapter swap is structural, not
 * behavioural, and provides the seam for future host divergence (Cursor
 * camelCase, Antigravity wrap differences) without further code changes.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';
import {
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
  GATE_DECISION_KIND,
  getGateBackend,
} from '@transcodes-guard/core/contract';
import { codexAdapter } from '@transcodes-guard/core/hosts';

async function main(): Promise<void> {
  const raw = readFileSync(0, 'utf8');
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
          kind: 'deny',
          reason: formatNoTokenReason(decision.block),
          systemMessage: formatNoTokenSystemMessage(decision.block),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_BY_POLICY:
      process.stdout.write(
        codexAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatRbacDeniedReason(decision),
          systemMessage: formatRbacDeniedSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED:
      process.stdout.write(
        codexAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupFailureReason(decision),
          systemMessage: formatStepupFailureSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED:
      // Browser launch + latch already handled in evaluatePreToolUse.
      process.stdout.write(
        codexAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupPendingReason(decision),
          systemMessage: formatStepupPendingSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED:
      process.stdout.write(
        codexAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupRejectedReason(decision),
          systemMessage: formatStepupRejectedSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard hook error: ${err}\n`);
  process.exit(0);
});
