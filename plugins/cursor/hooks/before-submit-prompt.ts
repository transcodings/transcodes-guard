#!/usr/bin/env node
/**
 * Cursor beforeSubmitPrompt hook — rotate the per-prompt grouping sid.
 *
 * Guard v3: each new user prompt opens a fresh step-up grouping window. Cursor's
 * beforeSubmitPrompt output is `{ continue, user_message? }` only (no
 * additional_context channel), and there is no local step-up state to
 * reconcile anymore — status lives in the backend (SSOT). So this hook just
 * mints a fresh grouping sid and emits `{ continue: true }`.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';
import { getGateBackend } from '@transcodes-guard/gate-contract';
import { cursorAdapter } from '@transcodes-guard/hook-adapters';

function emitContinue(): never {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

function main(): void {
  const raw = readFileSync(0, 'utf8');
  try {
    cursorAdapter.parseUserPromptSubmitStdin(raw);
  } catch {
    emitContinue();
  }
  getGateBackend().sweepLatches();
  getGateBackend().rotatePromptGroup();
  emitContinue();
}

try {
  main();
} catch (err) {
  process.stderr.write(
    `transcodes-guard before-submit-prompt hook error: ${err}\n`,
  );
  emitContinue();
}
