#!/usr/bin/env node
/**
 * Cursor beforeSubmitPrompt hook — capture current-turn context locally.
 * Cursor requires a `{ continue }` verdict, including on every failure path.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';
import { capturePrompt, cursorAdapter } from '@transcodes-guard/core/hosts';

function emitContinue(): never {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

try {
  const input = cursorAdapter.parseUserPromptSubmitStdin(
    readFileSync(0, 'utf8'),
  );
  capturePrompt({
    host: 'cursor',
    sessionId: input.sessionId,
    promptId: input.promptId,
    prompt: input.prompt,
  });
} catch {
  // Missing/malformed stdin and local cache failures are harmless.
}
emitContinue();
