#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — protocol primer + fresh grouping sid.
 *
 * Injects an `additionalContext` block describing how the agent should react
 * to PreToolUse step-up denies, and mints a fresh per-prompt grouping sid so a
 * new session starts a clean step-up grouping window. Pure additive context —
 * never blocks. Step-up status lives in the backend (SSOT), so there is no
 * carry-over state to surface.
 */
import '../host.js';
import '../backend.js';
import {
  formatNoTokenSessionNotice,
  formatStepupProtocolPrimer,
  getGateBackend,
} from '@transcodes-guard/gate-contract';
import { claudeCodeAdapter } from '@transcodes-guard/hook-adapters';
import { PLUGIN_VERSION } from '../src/version.js';

const PROTOCOL_PRIMER = formatStepupProtocolPrimer();

async function main(): Promise<void> {
  process.stderr.write(`[transcodes-guard] v${PLUGIN_VERSION}\n`);

  const backend = getGateBackend();
  backend.sweepLatches();
  // New session → fresh grouping window for step-up dedup.
  backend.rotatePromptGroup();

  const tokenNotice = backend.hasToken() ? null : formatNoTokenSessionNotice();
  const versionLine = `transcodes-guard v${PLUGIN_VERSION}`;
  const additionalContext = [versionLine, PROTOCOL_PRIMER, tokenNotice]
    .filter((s): s is string => Boolean(s))
    .join('\n');
  process.stdout.write(
    claudeCodeAdapter.emitSessionStartContext(additionalContext),
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard session-start hook error: ${err}\n`);
  process.exit(0);
});
