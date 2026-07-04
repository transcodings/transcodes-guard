#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — protocol primer + fresh grouping sid.
 *
 * Injects an `additionalContext` block describing how the agent should react
 * to PreToolUse step-up denies, and mints a fresh per-prompt grouping sid so a
 * new session starts a clean step-up grouping window. Pure additive context —
 * never blocks. Step-up status lives in the backend (SSOT), so there is no
 * carry-over state to surface.
 */
import '../host.js';
import '../backend.js';
import {
  formatNoTokenSessionNotice,
  getGateBackend,
} from '@transcodes-guard/gate-contract';
import { claudeCodeAdapter } from '@transcodes-guard/hook-adapters';
import { PLUGIN_VERSION } from '../src/version.js';

const PROTOCOL_PRIMER = [
  'transcodes-guard step-up MFA protocol:',
  '',
  'When a PreToolUse hook denies a Bash with `permissionDecision: "deny"`',
  'and the reason mentions Step-up MFA, the command was BLOCKED and',
  'did NOT execute. Drive the loop deterministically — DO NOT wait for',
  'user confirmation between steps:',
  '',
  '  1. Tell the user (one short line) to complete WebAuthn in the',
  '     auto-opened browser tab (use the URL from the deny message',
  '     if it did not open).',
  '  2. Immediately call the MCP tool `tc_poll_stepup_session_wait` with the',
  '     provided sid. It blocks until verified or 60s timeout — a single',
  '     call replaces the manual polling loop. (The legacy single-shot',
  '     `tc_poll_stepup_session` is only for diagnostics.)',
  '  3. On `outcome: "verified"` retry the SAME Bash command — the hook',
  '     detects the verified state locally and allows it. On `outcome:',
  '     "timeout"` ask the user to retry WebAuthn, then call the wait',
  '     tool again.',
  '',
  'Never assume the blocked command ran. Never invent an alternative',
  'command. Always resume from the pending sid the hook reported.',
].join('\n');

async function main(): Promise<void> {
  process.stderr.write(`[transcodes-guard] v${PLUGIN_VERSION}\n`);

  const backend = getGateBackend();
  backend.sweepLatches();
  // New session → fresh grouping window for step-up dedup.
  backend.rotatePromptSid();

  const tokenNotice = backend.hasToken() ? null : formatNoTokenSessionNotice();
  const versionLine = `transcodes-guard v${PLUGIN_VERSION}`;
  const additionalContext = [versionLine, PROTOCOL_PRIMER, tokenNotice]
    .filter((s): s is string => Boolean(s))
    .join('\n');
  process.stdout.write(
    claudeCodeAdapter.emitSessionStartContext(additionalContext),
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}\n`);
  process.exit(0);
});
