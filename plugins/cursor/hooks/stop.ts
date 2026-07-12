#!/usr/bin/env node
/**
 * Cursor Stop hook — no-op.
 *
 * Local latch / Stop MFA reminders were removed. Step-up SSOT is the backend
 * coordinate key; agents recover via PreToolUse deny + tc_poll_stepup_session_wait.
 */
import '../host.js';
import '../backend.js';

async function main(): Promise<void> {
  try {
    for await (const _chunk of process.stdin) {
      // discard
    }
  } catch {
    // ignore
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}\n`);
  process.exit(0);
});
