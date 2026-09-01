import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAskDesktopUrl, DEPLOY_VERIFY_PROMPT } from '../src/commands/transcodes/ask-desktop.js';

test('ask desktop URL carries prompt, cwd, and submit', () => {
  const url = new URL(
    buildAskDesktopUrl({
      prompt: DEPLOY_VERIFY_PROMPT,
      cwd: '/tmp/project',
      submit: true,
    }),
  );
  assert.equal(url.protocol, 'transcodes:');
  assert.equal(url.hostname, 'ask');
  assert.equal(url.searchParams.get('prompt'), DEPLOY_VERIFY_PROMPT);
  assert.equal(url.searchParams.get('cwd'), '/tmp/project');
  assert.equal(url.searchParams.get('submit'), '1');
});
