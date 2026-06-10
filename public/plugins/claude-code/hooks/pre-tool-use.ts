#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook — thin entrypoint over @transcodes-guard-private/stepup-core.
 *
 * All real logic (regex match, git ls-files semantic check, MCP tool-rule
 * lookup, fast-path verified consume, step-up MFA session creation) lives in
 * `evaluatePreToolUse` in stepup-core. This file:
 *   1. Parses stdin via the Claude Code adapter.
 *   2. Calls evaluatePreToolUse to produce a host-agnostic GateDecision.
 *   3. Renders the decision into Claude Code wire format via the adapter +
 *      message formatters.
 *   4. Performs the post-emit side effects in the right order (writePending
 *      AFTER stdout emit so a throw cannot suppress the deny — see
 *      `.claude/rules/hooks.md` "Order is load-bearing").
 *
 * Fail-open before any danger match, fail-safe after — same asymmetric policy
 * as the original 500-line file, now expressed in ~80 lines.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';
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
  getGateBackend,
} from '@transcodes-guard/gate-contract';
import { claudeCodeAdapter } from '@transcodes-guard/hook-adapters';

async function main(): Promise<void> {
  const raw = readFileSync(0, 'utf8');

  let input;
  try {
    input = claudeCodeAdapter.parsePreToolUseStdin(raw);
  } catch {
    // fail-open: stdin parse failure must not brick the workflow.
    process.exit(0);
  }

  const backend = getGateBackend();
  const decision = await backend.evaluatePreToolUse(input);

  switch (decision.kind) {
    case 'pass':
      process.exit(0);

    case 'allow':
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
          kind: 'allow',
          reason: formatAllowReason(decision),
        }),
      );
      if (decision.consumeHere) {
        backend.consumeVerified(decision.fp);
        backend.clearPending(decision.fp);
      }
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);

    case 'deny-no-token':
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

    case 'deny-rbac-denied':
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

    case 'deny-stepup-failure':
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

    case 'deny-stepup-pending':
      // Emit deny FIRST: writePending below may throw on disk failure, and
      // the deny JSON must already be on stdout in that case.
      process.stdout.write(
        claudeCodeAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupPendingReason(decision),
          systemMessage: formatStepupPendingSystemMessage(decision),
        }),
      );
      try {
        backend.writePending(decision.pending);
      } catch (err) {
        process.stderr.write(
          `transcodes-guard: pending file write failed (deny still emitted): ${err}\n`,
        );
      }
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard hook error: ${err}\n`);
  process.exit(0);
});
