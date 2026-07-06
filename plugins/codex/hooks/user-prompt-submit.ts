#!/usr/bin/env node
/**
 * Codex CLI UserPromptSubmit hook — rotate the per-prompt grouping sid.
 *
 * Same logic as the Claude Code variant (only the adapter import differs):
 * each new user prompt opens a fresh step-up grouping window. Step-up status
 * lives in the backend (SSOT); there is no local pending to surface. Never
 * blocks — always exits 0.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';
import { getGateBackend } from '@transcodes-guard/core/contract';
import { codexAdapter } from '@transcodes-guard/core/hosts';

function main(): void {
  const raw = readFileSync(0, 'utf8');
  try {
    codexAdapter.parseUserPromptSubmitStdin(raw);
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
