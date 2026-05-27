#!/usr/bin/env node
/**
 * Antigravity 2.0 PreToolUse hook — thin entrypoint over @ai-action-tracker/stepup-core.
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
import { readFileSync } from "node:fs";
import { antigravityAdapter } from "@ai-action-tracker/hook-adapters";
import {
  clearPending,
  consumeVerified,
  evaluatePreToolUse,
  formatAllowReason,
  formatNoTokenReason,
  formatNoTokenSystemMessage,
  formatStderrTag,
  formatStepupFailureReason,
  formatStepupFailureSystemMessage,
  formatStepupPendingReason,
  formatStepupPendingSystemMessage,
  writePending,
} from "@ai-action-tracker/stepup-core";

async function main(): Promise<void> {
  const raw = readFileSync(0, "utf8");

  let input;
  try {
    input = antigravityAdapter.parsePreToolUseStdin(raw);
  } catch {
    process.exit(0);
  }

  const decision = await evaluatePreToolUse(input);

  switch (decision.kind) {
    case "pass":
      process.exit(0);

    case "allow":
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "allow",
          reason: formatAllowReason(decision),
        }),
      );
      if (decision.consumeHere) {
        consumeVerified();
        clearPending();
      }
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case "deny-no-token":
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatNoTokenReason(decision.block),
          systemMessage: formatNoTokenSystemMessage(decision.block),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case "deny-stepup-failure":
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupFailureReason(decision),
          systemMessage: formatStepupFailureSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case "deny-stepup-pending":
      // Emit deny JSON before any side effect that can throw — the
      // asymmetric fail policy in evaluate.ts demands the stdout payload
      // be on the wire before writePending touches disk.
      process.stdout.write(
        antigravityAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupPendingReason(decision),
          systemMessage: formatStepupPendingSystemMessage(decision),
        }),
      );
      try {
        writePending(decision.pending);
      } catch (err) {
        process.stderr.write(
          `ai-action-tracker: pending file write failed (deny still emitted): ${err}\n`,
        );
      }
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`ai-action-tracker hook error: ${err}\n`);
  process.exit(0);
});
