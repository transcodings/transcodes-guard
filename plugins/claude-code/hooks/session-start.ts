#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — protocol primer.
 *
 * Injects an `additionalContext` block describing how the agent should react
 * to PreToolUse step-up denies. Pure additive context — never blocks. Step-up
 * status lives in the backend (SSOT), so there is no local state to prime or
 * carry-over state to surface.
 */
import '../host.js';
import '../backend.js';
import {
  formatNoTokenSessionNotice,
  formatStepupProtocolPrimer,
  getGateBackend,
} from '@transcodes-guard/core/contract';
import { claudeCodeAdapter } from '@transcodes-guard/core/hosts';
import { PLUGIN_VERSION } from '../src/version.js';

const PROTOCOL_PRIMER = formatStepupProtocolPrimer();

async function main(): Promise<void> {
  process.stderr.write(`[transcodes-guard] v${PLUGIN_VERSION}\n`);

  const backend = getGateBackend();
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
