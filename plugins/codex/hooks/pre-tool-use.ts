#!/usr/bin/env node
/**
 * Codex CLI PreToolUse hook — thin entrypoint over @transcodes-guard/stepup-core.
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
import { codexAdapter } from '@transcodes-guard/hook-adapters';

async function main(): Promise<void> {
  const raw = readFileSync(0, 'utf8');

  let input;
  try {
    input = codexAdapter.parsePreToolUseStdin(raw);
  } catch {
    process.exit(0);
  }

  const backend = getGateBackend();
  const decision = await backend.evaluatePreToolUse(input);

  switch (decision.kind) {
    case 'proceed-ungated':
    case 'proceed-by-policy':
      process.exit(0);

    case 'proceed-by-verification':
      process.stdout.write(
        codexAdapter.emitPreToolUse({
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

    case 'block-no-token':
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

    case 'block-by-policy':
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

    case 'block-stepup-create-failed':
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

    case 'block-stepup-challenged':
      process.stdout.write(
        codexAdapter.emitPreToolUse({
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
