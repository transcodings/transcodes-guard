#!/usr/bin/env node
/**
 * Cursor sessionStart hook — pending carry-over notice.
 *
 * Cursor's sessionStart output is `{ additional_context?, env? }`
 * (snake_case) — semantically identical to Claude Code's
 * `hookSpecificOutput.additionalContext` but flat. Mirror the codex hook
 * body verbatim; only the adapter import differs.
 */
import '../host.js';
import '../backend.js';
import {
  formatNoTokenSessionNotice,
  getGateBackend,
} from '@transcodes-guard/gate-contract';
import { cursorAdapter } from '@transcodes-guard/hook-adapters';

function carryoverBlock(): string | null {
  const pending = getGateBackend().firstActivePending();
  if (!pending) return null;
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

async function main(): Promise<void> {
  const tokenNotice = getGateBackend().hasToken()
    ? null
    : formatNoTokenSessionNotice();
  const parts = [carryoverBlock(), tokenNotice].filter((s): s is string =>
    Boolean(s),
  );
  if (parts.length > 0) {
    process.stdout.write(
      cursorAdapter.emitSessionStartContext(parts.join('\n')),
    );
  }
  // Policy bundle refresh (G2) AFTER the context emit (post-emit ordering,
  // same as the decision audit) — runs even when there is nothing to emit.
  await getGateBackend().refreshPolicyBundle();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}\n`);
  process.exit(0);
});
