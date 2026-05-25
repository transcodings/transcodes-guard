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

import {
  clearPending,
  consumeVerified,
  isExpired,
  readPending,
  readVerified,
} from "@ai-action-tracker/stepup-core";

function reminderFor(
  pending: NonNullable<ReturnType<typeof readPending>>,
): string {
  // Only the "pending" status path is reachable here — the "verified"
  // status is reaped by the orphan-cleanup branches in `main()` before
  // we ever construct a reminder.
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
  const verified = readVerified();

  // Orphan cleanup — the MCP fast-path leaves `verified.json` for the
  // tool handler to consume via `withStepupVerifiedSid`. If the handler
  // never reaches that wrapper (early throw, zod reject, transport drop)
  // OR the user authenticated but never called a protected tool, the
  // record persists. Stop firing means the turn is over, so any record
  // still around is by definition no longer in flight — reap it
  // silently. Avoids a false "dangling pending" reminder.
  //
  // Orphan A: verified record exists but pending is gone or not in the
  // "pending" state (e.g. status flipped to "verified" but the handler
  // failed before consuming).
  if (verified && (!pending || pending.status !== "pending")) {
    consumeVerified();
    if (pending) clearPending();
    process.exit(0);
  }
  // Orphan B: pending says "verified" but the verified file is gone —
  // handler consumed but clearPending was missed somewhere. No reminder
  // needed; the work is done.
  if (pending && !verified && pending.status === "verified") {
    clearPending();
    process.exit(0);
  }

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
