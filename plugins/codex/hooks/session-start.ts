#!/usr/bin/env node
/**
 * Codex CLI SessionStart hook — no-token notice.
 *
 * The static protocol primer lives in AGENTS.md (Codex auto-loads it into
 * every turn's system message). Step-up status lives in the backend (SSOT), so
 * there is no local state to prime and no carry-over to surface — this hook only
 * emits the notice when no token is configured. Pure additive context — never
 * blocks.
 */
import '../host.js';
import '../backend.js';
import {
  formatNoTokenSessionNotice,
  getGateBackend,
} from '@transcodes-guard/core/contract';
import { codexAdapter } from '@transcodes-guard/core/hosts';

async function main(): Promise<void> {
  const backend = getGateBackend();
  const tokenNotice = backend.hasToken() ? null : formatNoTokenSessionNotice();
  if (tokenNotice) {
    process.stdout.write(codexAdapter.emitSessionStartContext(tokenNotice));
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}\n`);
  process.exit(0);
});
