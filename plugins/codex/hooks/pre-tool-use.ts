#!/usr/bin/env node
/**
 * Codex CLI PreToolUse / PermissionRequest hook entrypoint.
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
  GATE_DECISION_KIND,
  getGateBackend,
} from '@transcodes-guard/gate-contract';
import {
  codexAdapter,
  emitCodexPermissionRequest,
  type PreToolUseInput,
  parseCodexPermissionRequestStdin,
} from '@transcodes-guard/hook-adapters';

function isPermissionRequest(raw: string): boolean {
  try {
    const payload = JSON.parse(raw) as { hook_event_name?: unknown };
    return payload.hook_event_name === 'PermissionRequest';
  } catch {
    return false;
  }
}

function emitAllow(permissionRequest: boolean, reason: string): string {
  return permissionRequest
    ? emitCodexPermissionRequest({ kind: 'allow' })
    : codexAdapter.emitPreToolUse({ kind: 'allow', reason });
}

function emitDeny(
  permissionRequest: boolean,
  reason: string,
  systemMessage: string,
): string {
  return permissionRequest
    ? emitCodexPermissionRequest({
        kind: 'deny',
        message: systemMessage
          .replaceAll('Bash command', 'tool call')
          .replaceAll('Bash was', 'Tool call was')
          .replaceAll('Bash blocked', 'Tool call blocked')
          .replaceAll('SAME Bash command', 'SAME tool call')
          .replaceAll('same Bash command', 'same tool call'),
      })
    : codexAdapter.emitPreToolUse({
        kind: 'deny',
        reason,
        systemMessage,
      });
}

async function main(): Promise<void> {
  const raw = readFileSync(0, 'utf8');
  const permissionRequest = isPermissionRequest(raw);

  let input: PreToolUseInput;
  try {
    input = permissionRequest
      ? parseCodexPermissionRequestStdin(raw)
      : codexAdapter.parsePreToolUseStdin(raw);
  } catch {
    process.exit(0);
    return;
  }

  const backend = getGateBackend();
  const decision = await backend.evaluatePreToolUse(input);

  switch (decision.kind) {
    case GATE_DECISION_KIND.PROCEED_UNGATED:
    case GATE_DECISION_KIND.PROCEED_BY_POLICY:
      process.exit(0);
      return;

    case GATE_DECISION_KIND.PROCEED_BY_VERIFICATION:
      process.stdout.write(
        emitAllow(permissionRequest, formatAllowReason(decision)),
      );
      if (decision.consumeHere) {
        backend.consumeVerified(decision.fp);
        backend.clearPending(decision.fp);
      }
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
      return;

    case GATE_DECISION_KIND.BLOCK_NO_TOKEN:
      process.stdout.write(
        emitDeny(
          permissionRequest,
          formatNoTokenReason(decision.block),
          formatNoTokenSystemMessage(decision.block),
        ),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
      return;

    case GATE_DECISION_KIND.BLOCK_BY_POLICY:
      process.stdout.write(
        emitDeny(
          permissionRequest,
          formatRbacDeniedReason(decision),
          formatRbacDeniedSystemMessage(decision),
        ),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
      return;

    case GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED:
      process.stdout.write(
        emitDeny(
          permissionRequest,
          formatStepupFailureReason(decision),
          formatStepupFailureSystemMessage(decision),
        ),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);
      return;

    case GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED:
      process.stdout.write(
        emitDeny(
          permissionRequest,
          formatStepupPendingReason(decision),
          formatStepupPendingSystemMessage(decision),
        ),
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
      return;
  }
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard hook error: ${err}\n`);
  process.exit(0);
});
