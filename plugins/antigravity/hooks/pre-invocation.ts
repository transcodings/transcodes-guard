#!/usr/bin/env node
/**
 * Antigravity 2.0 PreInvocation hook — SessionStart-equivalent primer.
 *
 * Antigravity has no SessionStart or UserPromptSubmit hook events
 * (PreToolUse / PostToolUse / PreInvocation / PostInvocation / Stop is the
 * complete event list). PreInvocation fires before every model call; on the
 * first call (`invocationNum <= 1`, with a defensive fallback for a
 * missing/non-numeric field) it injects a static step-up MFA primer plus the
 * no-token notice when no token is configured.
 *
 * Guard v3: step-up status lives in the backend (SSOT), so there is no
 * carry-over/pending state to surface — and no user-"done" bridge, because the
 * agent drives the poll loop from the deny message. The per-prompt grouping sid
 * is resolved lazily by a 10-minute TTL bucket (Antigravity has no prompt hook
 * to rotate it), so this hook does not touch it.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';
import {
  formatNoTokenSessionNotice,
  formatStepupProtocolPrimer,
  getGateBackend,
} from '@transcodes-guard/core/contract';
import {
  antigravityAdapter,
  type InjectStep,
} from '@transcodes-guard/core/hosts';

function primerMessage(): string {
  return formatStepupProtocolPrimer();
}

async function main(): Promise<void> {
  if (
    !antigravityAdapter.parsePreInvocationStdin ||
    !antigravityAdapter.emitPreInvocation
  ) {
    // antigravityAdapter is missing optional PreInvocation methods —
    // shouldn't happen unless the package is mis-built. Fail-open.
    process.exit(0);
  }

  const raw = readFileSync(0, 'utf8');

  let input;
  try {
    input = antigravityAdapter.parsePreInvocationStdin(raw);
  } catch {
    process.exit(0);
  }

  const backend = getGateBackend();
  const injectSteps: InjectStep[] = [];

  // SessionStart-equivalent: primer + no-token notice on first invocation only.
  if (input.invocationNum <= 1) {
    injectSteps.push({ ephemeralMessage: primerMessage() });
    if (!backend.hasToken()) {
      injectSteps.push({ ephemeralMessage: formatNoTokenSessionNotice() });
    }
  }

  process.stdout.write(antigravityAdapter.emitPreInvocation(injectSteps));
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`transcodes-guard pre-invocation hook error: ${err}\n`);
  process.exit(0);
});
