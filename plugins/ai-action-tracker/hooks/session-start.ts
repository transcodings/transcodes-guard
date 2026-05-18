#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — protocol primer for the step-up loop.
 *
 * Injects an `additionalContext` block describing how the agent should
 * react when PreToolUse denies a Bash with "Step-up MFA pending". Without
 * this primer the agent must re-derive the protocol from each deny
 * message; with it, the agent has a stable reference frame for the
 * entire session.
 *
 * If a pending step-up record carries over from a previous session
 * (Claude was restarted mid-flow), include sid + browserUrl so the agent
 * can resume polling instead of starting over.
 *
 * Fail policy: this hook is purely additive context. Any error path
 * writes nothing and exits 0 — the session must never be blocked or
 * derailed by a primer.
 */

import { isExpired, readPending } from "../src/stepup/pending.js";

const PROTOCOL_PRIMER = [
  "ai-action-tracker step-up MFA protocol:",
  "",
  "When a PreToolUse hook denies a Bash with `permissionDecision: \"deny\"`",
  "and the reason mentions Step-up MFA, the command was BLOCKED and",
  "did NOT execute. Drive the loop deterministically — DO NOT wait for",
  "user confirmation between steps:",
  "",
  "  1. Tell the user (one short line) to complete WebAuthn in the",
  "     auto-opened browser tab (use the URL from the deny message",
  "     if it did not open).",
  "  2. Immediately call the MCP tool `poll_stepup_session_wait` with the",
  "     provided sid. It blocks until verified or 60s timeout — a single",
  "     call replaces the manual polling loop. (The legacy single-shot",
  "     `poll_stepup_session` is only for diagnostics.)",
  "  3. On `outcome: \"verified\"` retry the SAME Bash command — the hook",
  "     detects the verified state locally and allows it. On `outcome:",
  "     \"timeout\"` ask the user to retry WebAuthn, then call the wait",
  "     tool again.",
  "",
  "Never assume the blocked command ran. Never invent an alternative",
  "command. Always resume from the pending sid the hook reported.",
].join("\n");

function carryoverBlock(): string | null {
  const pending = readPending();
  if (!pending) return null;
  if (isExpired(pending)) return null;
  const statusNote =
    pending.status === "verified"
      ? "VERIFIED but not yet consumed — retry the original command to release it."
      : "PENDING — resume polling.";
  return [
    "",
    "Carried-over step-up state from a previous session:",
    `  sid     : ${pending.sid}`,
    `  status  : ${pending.status} (${statusNote})`,
    `  command : ${pending.command}`,
    `  reason  : ${pending.reason}`,
    `  url     : ${pending.browserUrl}`,
  ].join("\n");
}

function main(): void {
  const carry = carryoverBlock();
  const additionalContext = carry ? `${PROTOCOL_PRIMER}\n${carry}` : PROTOCOL_PRIMER;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
    }),
  );
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`ai-action-tracker session-start hook error: ${err}\n`);
  process.exit(0);
}
