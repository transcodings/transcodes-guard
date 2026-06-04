#!/usr/bin/env node
/**
 * Claude Code Stop hook — catches a dangling step-up loop + reaps orphans.
 *
 * Orphan cleanup rules (silent — no reminder JSON):
 *   - verified record exists + pending gone or status != "pending"
 *   - pending says "verified" + verified file gone
 *
 * Otherwise, if a real pending record is in flight, emit a top-level
 * `{ decision: "block", reason }` reminder. Stop is excluded from the
 * `hookSpecificOutput` enum — wrapping it makes the validator reject.
 */
import "../host.js";
import { claudeCodeAdapter } from "@transcodes-guard/hook-adapters";
import {
  clearPending,
  consumeVerified,
  firstInFlightFpPending,
  isExpired,
  readPending,
  readVerified,
  sweepStepup,
  type PendingState,
} from "@transcodes-guard/stepup-core";

function reminderFor(pending: PendingState): string {
  return [
    "transcodes-guard: a step-up MFA session is still PENDING. The Bash",
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
  // Drain stdin even though we don't read it; some hosts require it.
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }

  // Silent housekeeping for the FP-KEYED (Bash + user tool-rule) files:
  // reap orphans + sweep expired. GLOBAL (MCP system) orphan reap stays
  // inline below for backward-compatible behaviour.
  sweepStepup();

  const pending = readPending();
  const verified = readVerified();

  // Orphan A: GLOBAL verified file exists but pending is gone or non-pending.
  if (verified && (!pending || pending.status !== "pending")) {
    consumeVerified();
    if (pending) clearPending();
    process.exit(0);
  }
  // Orphan B: GLOBAL pending says verified but the verified file is gone.
  if (pending && !verified && pending.status === "verified") {
    clearPending();
    process.exit(0);
  }

  // Remind on the first in-flight session: GLOBAL first (unchanged), else
  // any FP-KEYED Bash/user session still awaiting verification.
  const reminder =
    pending && !isExpired(pending) ? pending : firstInFlightFpPending();
  if (!reminder) process.exit(0);

  process.stdout.write(claudeCodeAdapter.emitStop(reminderFor(reminder)));
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}\n`);
  process.exit(0);
});
