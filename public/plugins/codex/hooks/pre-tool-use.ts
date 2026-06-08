#!/usr/bin/env node
/**
 * Codex CLI PreToolUse hook — thin entrypoint over @transcodes-guard-private/stepup-core.
 *
 * Mirrors plugins/claude-code-ai-action-tracker/hooks/pre-tool-use.ts; the
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
    case 'pass':
      process.exit(0);

    case 'allow':
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
      process.exit(0);

    case 'deny-no-token':
      process.stdout.write(
        codexAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatNoTokenReason(decision.block),
          systemMessage: formatNoTokenSystemMessage(decision.block),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case 'deny-rbac-denied':
      process.stdout.write(
        codexAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatRbacDeniedReason(decision),
          systemMessage: formatRbacDeniedSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case 'deny-stepup-failure':
      process.stdout.write(
        codexAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupFailureReason(decision),
          systemMessage: formatStepupFailureSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case 'deny-stepup-pending':
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
      process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard hook error: ${err}\n`);
  process.exit(0);
});
