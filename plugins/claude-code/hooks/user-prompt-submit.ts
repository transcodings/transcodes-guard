#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — rotate the per-prompt grouping sid.
 *
 * Guard v3: each new user prompt opens a fresh step-up grouping window, so the
 * repeated tool calls of THIS prompt dedupe onto one MFA challenge (backend
 * cache keyed on the sid) without leaking into the next prompt. Step-up status
 * lives in the backend (SSOT); there is no local pending to surface here.
 * Never blocks — always exits 0.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';
import { getGateBackend } from '@transcodes-guard/gate-contract';
import { claudeCodeAdapter } from '@transcodes-guard/hook-adapters';

function main(): void {
  const raw = readFileSync(0, 'utf8');
  try {
    claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
  } catch {
    process.exit(0);
  }
  const backend = getGateBackend();
  backend.sweepLatches();
  backend.rotatePromptGroup();
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(
    `transcodes-guard user-prompt-submit hook error: ${err}\n`,
  );
  process.exit(0);
}
