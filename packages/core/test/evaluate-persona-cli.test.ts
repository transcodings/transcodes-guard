import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyToolCall } from '../src/stepup/evaluate.js';

describe('Persona CLI guard exemption', () => {
  it('does not classify local Persona commands for remote evaluation', () => {
    const classified = classifyToolCall(
      {
        toolName: 'Bash',
        toolInput: { command: 'transcodes persona list --persona developer' },
        cwd: '/tmp',
      },
      'claude',
    );

    assert.equal(classified, null);
  });

  it('continues classifying other Transcodes commands', () => {
    const classified = classifyToolCall(
      {
        toolName: 'Bash',
        toolInput: { command: 'transcodes login' },
        cwd: '/tmp',
      },
      'claude',
    );

    assert.notEqual(classified, null);
  });
});
