#!/usr/bin/env node
/**
 * Cursor PreToolUse hook — shared entry for beforeShellExecution and
 * beforeMCPExecution.
 *
 * Wire format diverges from Claude Code: stdout is FLAT
 * `{ permission: "allow"|"deny", user_message?, agent_message?, updated_input? }`
 * with no `hookSpecificOutput` wrapper. The cursorAdapter renders this;
 * everything else (stdin parse, gate evaluation, side-effect ordering)
 * mirrors the Claude Code / Codex entrypoint verbatim.
 *
 * Cursor's stdin already uses snake_case (`tool_name`, `tool_input`, `cwd`),
 * matching Claude Code, so parsing delegates to claudeCodeAdapter through
 * cursorAdapter. The classifier in stepup-core accepts `Shell` (Cursor) in
 * addition to `Bash` / `run_command`.
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
import { cursorAdapter } from '@transcodes-guard/core/hosts';

async function main(): Promise<void> {
  const raw = readFileSync(0, 'utf8');
  const input = cursorAdapter.parsePreToolUseStdin(raw);

  const backend = getGateBackend();
  const decision = await backend.evaluatePreToolUse(input);

  switch (decision.kind) {
    case GATE_DECISION_KIND.PROCEED_UNGATED:
    case GATE_DECISION_KIND.PROCEED_BY_POLICY:
      process.stdout.write(
        cursorAdapter.emitPreToolUse({ kind: 'allow', reason: '' }),
      );
      process.exit(0);

    case GATE_DECISION_KIND.BLOCK_NO_TOKEN:
      process.stdout.write(
        cursorAdapter.emitPreToolUse({
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
        cursorAdapter.emitPreToolUse({
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
        cursorAdapter.emitPreToolUse({
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
        cursorAdapter.emitPreToolUse({
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
        cursorAdapter.emitPreToolUse({
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
