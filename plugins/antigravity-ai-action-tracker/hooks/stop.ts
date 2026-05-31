#!/usr/bin/env node
/**
 * Antigravity 2.0 Stop hook — dangling step-up reminder + orphan reap.
 *
 * Same gate-logic flow as the Claude Code / Codex Stop hooks; the only
 * Antigravity-specific surface is the wire format. Antigravity's Stop hook
 * uses `{ decision: "continue", reason }` to prevent turn termination and
 * inject `reason` as a system message — the opposite verb from Claude
 * Code's `decision: "block"`, but the same UX intent. Whether `reason` is
 * actually surfaced to the model (vs silently dropped) is pending e2e
 * validation — see docs/research/antigravity-e2e-findings.md #4.
 */
import "../host.js";
import { antigravityAdapter } from "@transcodes-guard/hook-adapters";
import {
  clearPending,
  consumeVerified,
  isExpired,
  readPending,
  readVerified,
  type PendingState,
} from "@transcodes-guard/stepup-core";

function reminderFor(pending: PendingState): string {
  return [
    "transcodes-guard: a step-up MFA session is still PENDING. The shell",
    "command it gated was NOT executed. Resume the loop or report to the",
    "user that authentication is still required.",
    "",
    `Session sid     : ${pending.sid}`,
    `Original command: ${pending.command}`,
    `Browser URL     : ${pending.browserUrl}`,
    "",
    "Next action:",
    `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
    '  - On `outcome: "verified"` retry the exact original command.',
  ].join("\n");
}

async function main(): Promise<void> {
  // Drain stdin so the host doesn't block on EPIPE if it tries to write
  // additional context after we've decided.
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }

  const pending = readPending();
  const verified = readVerified();

  // Orphan reap: verified record exists without an in-flight pending →
  // silently consume (the gate's fast-path didn't get a chance to). This
  // is the same backstop as the Claude Code / Codex Stop hooks.
  if (verified && (!pending || pending.status !== "pending")) {
    consumeVerified();
    if (pending) clearPending();
    process.exit(0);
  }
  if (pending && !verified && pending.status === "verified") {
    clearPending();
    process.exit(0);
  }

  if (!pending || isExpired(pending)) process.exit(0);

  process.stdout.write(antigravityAdapter.emitStop(reminderFor(pending)));
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}\n`);
  process.exit(0);
});
