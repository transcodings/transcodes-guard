#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — capture current-turn context locally.
 * Always exits silently and fail-soft; prompt telemetry never blocks a turn.
 */
import '../host.js';
import '../backend.js';
import { readFileSync } from 'node:fs';
import { capturePrompt, claudeCodeAdapter } from '@transcodes-guard/core/hosts';

try {
  const input = claudeCodeAdapter.parseUserPromptSubmitStdin(
    readFileSync(0, 'utf8'),
  );
  capturePrompt({
    host: 'claude',
    sessionId: input.sessionId,
    promptId: input.promptId,
    prompt: input.prompt,
  });
} catch {
  // Missing/malformed stdin and local cache failures are harmless.
}
process.exit(0);
