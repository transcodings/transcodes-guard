#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook — thin entrypoint over @transcodes-guard/stepup-core.
 *
 * All real logic (regex match, git ls-files semantic check, MCP tool-rule
 * lookup, backend RBAC evaluate, grouped step-up session create/reuse, and the
 * crash-safe browser launch + per-coordinate latch write) lives in
 * `evaluatePreToolUse` in stepup-core. This file:
 *   1. Parses stdin via the Claude Code adapter.
 *   2. Calls evaluatePreToolUse to produce a host-agnostic GateDecision.
 *   3. Renders the decision into Claude Code wire format via the adapter +
 *      message formatters, then fires the decision audit.
 *
 * Fail-open before any danger match, fail-safe after — same asymmetric policy
 * as the original 500-line file, now expressed in ~80 lines.
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
} from '@transcodes-guard/gate-contract';
import { claudeCodeAdapter } from '@transcodes-guard/hook-adapters';

async function main(): Promise<void> {
  const raw = readFileSync(0, 'utf8');
  const input = claudeCodeAdapter.parsePreToolUseStdin(raw);

  const backend = getGateBackend();
  const decision = await backend.evaluatePreToolUse(input);

  switch (decision.kind) {
    case GATE_DECISION_KIND.PROCEED_UNGATED:
    case GATE_DECISION_KIND.PROCEED_BY_POLICY:
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_NO_TOKEN:
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
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
        claudeCodeAdapter.emitPreToolUse({
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
        claudeCodeAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupFailureReason(decision),
          systemMessage: formatStepupFailureSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED:
      // The browser launch + per-coordinate latch were already handled inside
      // evaluatePreToolUse (crash-safe, never throws). The hook only emits the
      // deny and fires the audit.
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
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
        claudeCodeAdapter.emitPreToolUse({
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
