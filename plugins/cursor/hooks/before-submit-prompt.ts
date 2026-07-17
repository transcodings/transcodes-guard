#!/usr/bin/env node
/**
 * Cursor beforeSubmitPrompt hook — intentionally inert, but must still speak.
 *
 * Guard v3 keeps every step-up status on the backend (SSOT): reuse is keyed by
 * the Redis coordinate and session dedupe (not tab dedupe, t8) is the backend's SET NX claim, so a
 * new prompt has no local grouping window to rotate and no local latch to sweep
 * (t3 removed both). Unlike the other hosts' prompt hooks this one is NOT
 * silent: Cursor's beforeSubmitPrompt contract requires a `{ continue }` verdict
 * on stdout, so it always emits `{ continue: true }` — on parse failure and on
 * an unexpected throw alike. Never blocks.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';

function emitContinue(): never {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

try {
  readFileSync(0, 'utf8');
} catch {
  // No stdin (or a closed pipe) is fine — this hook has nothing to read it for.
}
emitContinue();
