#!/usr/bin/env node
/**
 * Antigravity 2.0 Stop hook — silent housekeeping only.
 *
 * Deadlock fix (Guard v3 grouping): the Stop hook NEVER blocks the turn for an
 * in-flight step-up. A pending MFA lives in the backend cache (SSOT), not on
 * disk, so there is nothing local to reconcile — the only client-side state is
 * the per-coordinate browser latch. Stop just reaps expired latches (orphaned
 * when a host killed the PreToolUse hook mid-flight) and exits 0.
 */
import '../host.js';
import '../backend.js';
import { getGateBackend } from '@transcodes-guard/gate-contract';

async function main(): Promise<void> {
  // Drain stdin even though we don't read it; some hosts require it.
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }

  // Reap expired browser/poll latches. Never blocks the turn.
  getGateBackend().sweepLatches();

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}\n`);
  process.exit(0);
});
