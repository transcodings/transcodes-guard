#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — protocol primer + carry-over notice.
 *
 * Injects an `additionalContext` block describing how the agent should react
 * to PreToolUse step-up denies, plus a pointer to any session-spanning
 * pending sid that survived a restart. Pure additive context — never blocks.
 */
import '../host.js';
import { claudeCodeAdapter } from '@transcodes-guard/hook-adapters';
import {
  firstActivePending,
  formatNoTokenSessionNotice,
  resolveToken,
} from '@transcodes-guard-private/stepup-core';
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
  '  2. Immediately call the MCP tool `poll_stepup_session_wait` with the',
  '     provided sid. It blocks until verified or 60s timeout — a single',
  '     call replaces the manual polling loop. (The legacy single-shot',
  '     `poll_stepup_session` is only for diagnostics.)',
  '  3. On `outcome: "verified"` retry the SAME Bash command — the hook',
  '     detects the verified state locally and allows it. On `outcome:',
  '     "timeout"` ask the user to retry WebAuthn, then call the wait',
  '     tool again.',
  '',
  'Never assume the blocked command ran. Never invent an alternative',
  'command. Always resume from the pending sid the hook reported.',
].join('\n');

function carryoverBlock(): string | null {
  const pending = firstActivePending();
  if (!pending) return null;
  const statusNote =
    pending.status === 'verified'
      ? 'VERIFIED but not yet consumed — retry the original command to release it.'
      : 'PENDING — resume polling.';
  return [
    '',
    'Carried-over step-up state from a previous session:',
    `  sid     : ${pending.sid}`,
    `  status  : ${pending.status} (${statusNote})`,
    `  command : ${pending.command}`,
    `  reason  : ${pending.reason}`,
    `  url     : ${pending.browserUrl}`,
  ].join('\n');
}

function main(): void {
  process.stderr.write(`[transcodes-guard] v${PLUGIN_VERSION}\n`);

  const carry = carryoverBlock();
  const tokenNotice = resolveToken().token
    ? null
    : formatNoTokenSessionNotice();
  const versionLine = `transcodes-guard v${PLUGIN_VERSION}`;
  const additionalContext = [versionLine, PROTOCOL_PRIMER, carry, tokenNotice]
    .filter((s): s is string => Boolean(s))
    .join('\n');
  process.stdout.write(
    claudeCodeAdapter.emitSessionStartContext(additionalContext),
  );
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}\n`);
  process.exit(0);
}
