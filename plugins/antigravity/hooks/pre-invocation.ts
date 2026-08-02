#!/usr/bin/env node
/**
 * Antigravity 2.0 PreInvocation hook — primer + prompt capture.
 *
 * Antigravity has no SessionStart or UserPromptSubmit hook events
 * (PreToolUse / PostToolUse / PreInvocation / PostInvocation / Stop is the
 * complete event list). PreInvocation fires before every model call; on the
 * first call (`invocationNum === 0`) it injects a static step-up MFA primer plus
 * the no-token notice when no token is configured. Because Antigravity has no
 * prompt hook, the latest transcript user message is cached here instead.
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
  capturePrompt,
  type InjectStep,
  latestUserPromptFromTranscript,
} from '@transcodes-guard/core/hosts';

function primerMessage(): string {
  return formatStepupProtocolPrimer();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureLatestPrompt(
  input: ReturnType<
    NonNullable<typeof antigravityAdapter.parsePreInvocationStdin>
  >,
): Promise<void> {
  if (!input.conversationId || !input.transcriptPath) return;
  const delays = input.invocationNum === 0 ? [0, 25, 75] : [0];
  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    const prompt = latestUserPromptFromTranscript(input.transcriptPath);
    if (!prompt) continue;
    capturePrompt({
      host: 'antigravity',
      sessionId: input.conversationId,
      prompt,
      forceRefresh: input.invocationNum === 0,
    });
    return;
  }
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

  let input: ReturnType<
    NonNullable<typeof antigravityAdapter.parsePreInvocationStdin>
  >;
  try {
    input = antigravityAdapter.parsePreInvocationStdin(raw);
  } catch {
    process.exit(0);
  }

  const backend = getGateBackend();
  const injectSteps: InjectStep[] = [];

  await captureLatestPrompt(input);

  // SessionStart-equivalent: primer + no-token notice on first invocation only.
  if (input.invocationNum === 0) {
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
