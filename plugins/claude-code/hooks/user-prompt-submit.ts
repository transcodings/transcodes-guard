#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — intentionally inert.
 *
 * Guard v3 keeps every step-up status on the backend (SSOT): reuse is keyed by
 * the Redis coordinate and browser dedupe is the backend's SET NX claim, so a
 * new prompt has no local grouping window to rotate and no local latch to sweep
 * (t3 removed both). The hook stays registered because the host manifest wires
 * it; it drains stdin so the host's writer never blocks, then exits 0 without
 * emitting a decision. Never blocks.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';

try {
  readFileSync(0, 'utf8');
} catch {
  // No stdin (or a closed pipe) is fine — this hook has nothing to read it for.
}
process.exit(0);
