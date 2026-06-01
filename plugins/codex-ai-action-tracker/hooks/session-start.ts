#!/usr/bin/env node
/**
 * Codex CLI SessionStart hook — pending carry-over notice only.
 *
 * The static protocol primer lives in AGENTS.md (Codex auto-loads it into
 * every turn's system message), so this hook focuses on the dynamic part:
 * if a step-up session carried over from the previous session, surface its
 * sid + status so the agent can resume polling instead of starting over.
 * Pure additive context — never blocks.
 */
import '../host.js';
import { codexAdapter } from '@transcodes-guard/hook-adapters';
import {
  formatNoTokenSessionNotice,
  isExpired,
  isTrackerEnabled,
  readPending,
  resolveToken,
} from '@transcodes-guard-private/stepup-core';

function carryoverBlock(): string | null {
  const pending = readPending();
  if (!pending) return null;
  if (isExpired(pending)) return null;
  const statusNote =
    pending.status === 'verified'
      ? 'VERIFIED but not yet consumed — retry the original command to release it.'
      : 'PENDING — resume polling.';
  return [
    'Carried-over step-up state from a previous session:',
    `  sid     : ${pending.sid}`,
    `  status  : ${pending.status} (${statusNote})`,
    `  command : ${pending.command}`,
    `  reason  : ${pending.reason}`,
    `  url     : ${pending.browserUrl}`,
  ].join('\n');
}

function main(): void {
  // Gate disabled: stay silent (no carry-over, no token nag).
  if (!isTrackerEnabled()) process.exit(0);

  const tokenNotice = resolveToken().token
    ? null
    : formatNoTokenSessionNotice();
  const parts = [carryoverBlock(), tokenNotice].filter((s): s is string =>
    Boolean(s),
  );
  if (parts.length === 0) process.exit(0);
  process.stdout.write(codexAdapter.emitSessionStartContext(parts.join('\n')));
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}\n`);
  process.exit(0);
}
