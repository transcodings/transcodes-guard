#!/usr/bin/env node
/**
 * Codex CLI SessionStart hook — fresh grouping sid + no-token notice.
 *
 * The static protocol primer lives in AGENTS.md (Codex auto-loads it into
 * every turn's system message). Step-up status lives in the backend (SSOT), so
 * there is no carry-over state to surface — this hook only mints a fresh
 * per-prompt grouping sid and, when no token is configured, emits the notice.
 * Pure additive context — never blocks.
 */
import '../host.js';
import '../backend.js';
import {
  formatNoTokenSessionNotice,
  getGateBackend,
} from '@transcodes-guard/gate-contract';
import { codexAdapter } from '@transcodes-guard/hook-adapters';

async function main(): Promise<void> {
  const backend = getGateBackend();
  backend.rotatePromptSid();
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
