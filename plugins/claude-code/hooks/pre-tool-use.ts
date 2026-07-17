#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook — thin entrypoint over @transcodes-guard/core/stepup.
 *
 * All real logic (regex match, git ls-files semantic check, MCP tool-rule
 * lookup, backend RBAC evaluate, coordinate step-up session create/reuse, and
 * crash-safe browser launch on exist:false) lives in
 * `evaluatePreToolUse` in core/stepup. This file:
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
  GATE_DECISION_KIND,
  getGateBackend,
} from '@transcodes-guard/core/contract';
import { claudeCodeAdapter } from '@transcodes-guard/core/hosts';

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
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_BY_POLICY:
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatBlockByPolicyReason(decision),
          systemMessage: formatBlockByPolicySystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED:
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupCreateFailedReason(decision),
          systemMessage: formatStepupCreateFailedSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED:
      // Browser launch already handled in evaluatePreToolUse (every pending challenge, t8).
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupChallengedReason(decision),
          systemMessage: formatStepupChallengedSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
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
      process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard hook error: ${err}\n`);
  process.exit(0);
});
