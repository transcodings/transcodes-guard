#!/usr/bin/env node
/**
 * Codex CLI PreToolUse hook — thin entrypoint over @ai-action-tracker/stepup-core.
 *
 * Mirrors plugins/claude-code-ai-action-tracker/hooks/pre-tool-use.ts; the
 * only divergence is the adapter (codexAdapter). Codex's wire format
 * converged on Claude Code's PreToolUse contract, so the bytes emitted
 * here are byte-for-byte identical — the adapter swap is structural, not
 * behavioural, and provides the seam for future host divergence (Cursor
 * camelCase, Antigravity wrap differences) without further code changes.
 */
import { readFileSync } from "node:fs";
import { codexAdapter } from "@ai-action-tracker/hook-adapters";
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
    input = codexAdapter.parsePreToolUseStdin(raw);
  } catch {
    process.exit(0);
  }

  const decision = await evaluatePreToolUse(input);

  switch (decision.kind) {
    case "pass":
      process.exit(0);

    case "allow":
      process.stdout.write(
        codexAdapter.emitPreToolUse({
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
        codexAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatNoTokenReason(decision.block),
          systemMessage: formatNoTokenSystemMessage(decision.block),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case "deny-stepup-failure":
      process.stdout.write(
        codexAdapter.emitPreToolUse({
          kind: "deny",
          reason: formatStepupFailureReason(decision),
          systemMessage: formatStepupFailureSystemMessage(decision),
        }),
      );
      process.stderr.write(`${formatStderrTag(decision)}\n`);
      process.exit(0);

    case "deny-stepup-pending":
      process.stdout.write(
        codexAdapter.emitPreToolUse({
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
