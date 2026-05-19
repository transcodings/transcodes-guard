#!/usr/bin/env node
/**
 * Claude Code Stop hook — catches a dangling step-up loop.
 *
 * If the agent finishes its turn while a pending step-up record is
 * still in flight, that almost always means the loop was forgotten
 * mid-protocol. This hook injects a reminder via `additionalContext`
 * so the next model request sees what remains to be done.
 *
 * Never blocks (no `decision: "block"`). Any error path is a no-op.
 */

import { isExpired, readPending } from "../src/stepup/pending.js";

function reminderFor(
  pending: NonNullable<ReturnType<typeof readPending>>,
): string {
  if (pending.status === "verified") {
    return [
      "ai-action-tracker: a step-up MFA session is VERIFIED but the original",
      "Bash command has not been retried yet. Retry it now to release the",
      "single-shot verified record before it expires.",
      "",
      `Session sid     : ${pending.sid}`,
      `Original command: ${pending.command}`,
    ].join("\n");
  }
  return [
    "ai-action-tracker: a step-up MFA session is still PENDING. The Bash",
    "command it gated was NOT executed. Resume the loop or report to the",
    "user that authentication is still required.",
    "",
    `Session sid     : ${pending.sid}`,
    `Original command: ${pending.command}`,
    `Browser URL     : ${pending.browserUrl}`,
    "",
    "Next action:",
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original Bash command.',
  ].join("\n");
}

async function main(): Promise<void> {
  // We do not need to parse stdin — Stop's payload carries nothing we
  // rely on, and reading is best-effort to drain the pipe.
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }

  const pending = readPending();
  if (!pending || isExpired(pending)) process.exit(0);

  // Stop hook spec: emit `decision: "block"` + `reason` only. The
  // harness surfaces `reason` to the next turn directly; Stop is not
  // in the allowed `hookSpecificOutput.hookEventName` enum, so adding
  // that block makes the validator reject the JSON ("Invalid input").
  const reminder = reminderFor(pending);
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: reminder,
    }),
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`ai-action-tracker stop hook error: ${err}\n`);
  process.exit(0);
});
