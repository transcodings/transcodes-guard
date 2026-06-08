#!/usr/bin/env node
/**
 * Antigravity 2.0 PreToolUse hook — thin entrypoint over @transcodes-guard-private/stepup-core.
 *
 * Unlike the Codex entry (which delegates to claudeCodeAdapter), this one
 * uses antigravityAdapter — a fully native wire-format adapter. The bytes
 * emitted from here are NOT compatible with Claude Code's hook validator:
 * stdin is `toolCall.name/args` (camelCase, nested), stdout is top-level
 * `{ decision, reason }` instead of `hookSpecificOutput.permissionDecision`.
 * See packages/hook-adapters/src/antigravity.ts for the schema rationale.
 *
 * Tool matcher: `run_command` only (1차 출시 scope). Antigravity's file-edit
 * tools (`write_to_file`, `replace_file_content`, …) and MCP tool calls are
 * intentionally not gated — see the plugin README for the scope rationale.
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
import { antigravityAdapter } from '@transcodes-guard/hook-adapters';

async function main(): Promise<void> {
  const raw = readFileSync(0, 'utf8');

  let input;
  try {
    input = antigravityAdapter.parsePreToolUseStdin(raw);
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
        antigravityAdapter.emitPreToolUse({
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
        antigravityAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatNoTokenReason(decision.block),
          systemMessage: formatNoTokenSystemMessage(decision.block),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case 'deny-rbac-denied':
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatRbacDeniedReason(decision),
          systemMessage: formatRbacDeniedSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case 'deny-stepup-failure':
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupFailureReason(decision),
          systemMessage: formatStepupFailureSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case 'deny-stepup-pending':
      // Emit deny JSON before any side effect that can throw — the
      // asymmetric fail policy in evaluate.ts demands the stdout payload
      // be on the wire before writePending touches disk.
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
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
