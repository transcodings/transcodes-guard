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
import { cursorAdapter } from '@transcodes-guard/hook-adapters';

async function main(): Promise<void> {
  const raw = readFileSync(0, 'utf8');

  let input;
  try {
    input = cursorAdapter.parsePreToolUseStdin(raw);
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
        cursorAdapter.emitPreToolUse({
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
        cursorAdapter.emitPreToolUse({
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
        cursorAdapter.emitPreToolUse({
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
        cursorAdapter.emitPreToolUse({
          kind: 'deny',
          reason: formatStepupFailureReason(decision),
          systemMessage: formatStepupFailureSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      await backend.sendGateDecisionAudit(decision);
      process.exit(0);

    case 'deny-stepup-pending':
      process.stdout.write(
        cursorAdapter.emitPreToolUse({
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
