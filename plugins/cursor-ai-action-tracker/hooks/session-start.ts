#!/usr/bin/env node
/**
 * Cursor sessionStart hook — pending carry-over notice.
 *
 * Cursor's sessionStart output is `{ additional_context?, env? }`
 * (snake_case) — semantically identical to Claude Code's
 * `hookSpecificOutput.additionalContext` but flat. Mirror the codex hook
 * body verbatim; only the adapter import differs.
 */
import "../host.js";
import { cursorAdapter } from "@ai-action-tracker/hook-adapters";
import {
  formatNoTokenSessionNotice,
  isExpired,
  readPending,
  resolveToken,
} from "@ai-action-tracker/stepup-core";

function carryoverBlock(): string | null {
  const pending = readPending();
  if (!pending) return null;
  if (isExpired(pending)) return null;
  const statusNote =
    pending.status === "verified"
      ? "VERIFIED but not yet consumed — retry the original command to release it."
      : "PENDING — resume polling.";
  return [
    "Carried-over step-up state from a previous session:",
    `  sid     : ${pending.sid}`,
    `  status  : ${pending.status} (${statusNote})`,
    `  command : ${pending.command}`,
    `  reason  : ${pending.reason}`,
    `  url     : ${pending.browserUrl}`,
  ].join("\n");
}

function main(): void {
  const tokenNotice = resolveToken().token ? null : formatNoTokenSessionNotice();
  const parts = [carryoverBlock(), tokenNotice].filter(
    (s): s is string => Boolean(s),
  );
  if (parts.length === 0) process.exit(0);
  process.stdout.write(cursorAdapter.emitSessionStartContext(parts.join("\n")));
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`ai-action-tracker session-start hook error: ${err}\n`);
  process.exit(0);
}
