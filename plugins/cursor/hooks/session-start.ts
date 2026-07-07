#!/usr/bin/env node
/**
 * Cursor sessionStart hook — fresh grouping sid + no-token notice.
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
} from '@transcodes-guard/core/contract';
import { cursorAdapter } from '@transcodes-guard/core/hosts';

async function main(): Promise<void> {
  const backend = getGateBackend();
  backend.sweepLatches();
  backend.rotatePromptGroup();
  const tokenNotice = backend.hasToken() ? null : formatNoTokenSessionNotice();
  if (tokenNotice) {
    process.stdout.write(cursorAdapter.emitSessionStartContext(tokenNotice));
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}\n`);
  process.exit(0);
});
