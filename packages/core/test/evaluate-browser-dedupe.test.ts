/**
 * Regression: every pending challenge opens a tab, regardless of backend
 * `exist` (t8). SET NX dedupes the session mint, not the tab — reused pending
 * (exist:true) launches too.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeHomeSandbox, startJsonBackend } from './helpers/evaluate-harness.js';

function pendingVerdict(opts: {
  sid: string;
  resource: string;
  action: string;
  exist: boolean;
}) {
  return {
    logId: 'x',
    success: true,
    statusCode: 201,
    error: null,
    payload: [
      {
        permission: 2,
        resource: opts.resource,
        action: opts.action,
        reasoning: '',
        summary: 'step-up',
        provider: 'cursor',
        sid: opts.sid,
        url: `https://auth.example/?sid=${opts.sid}`,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        exist: opts.exist,
        status: 'pending',
      },
    ],
  };
}

describe('coordinate exist browser launch', () => {
  let server: Server | undefined;
  let home = '';
  const origHome = process.env.HOME;
  const origUrl = process.env.TRANSCODES_BACKEND_URL;

  beforeEach(() => {
    home = makeHomeSandbox('coord-exist-');
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    process.env.HOME = origHome;
    if (origUrl === undefined) {
      delete process.env.TRANSCODES_BACKEND_URL;
    } else {
      process.env.TRANSCODES_BACKEND_URL = origUrl;
    }
    rmSync(home, { recursive: true, force: true });
  });

  it('sets browserLaunched on fresh pending (exist:false)', async () => {
    const backend = await startJsonBackend(() => ({
      status: 200,
      body: pendingVerdict({
        sid: 'tc_stepup_fresh',
        resource: 'gmail',
        action: 'read',
        exist: false,
      }),
    }));
    server = backend.server;
    process.env.TRANSCODES_BACKEND_URL = backend.url;

    const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command: 'curl gmail' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-stepup-challenged');
    if (decision.kind !== 'block-stepup-challenged') return;
    assert.equal(decision.sid, 'tc_stepup_fresh');
    assert.equal(decision.browserLaunched, true);
    assert.equal(decision.resource, 'gmail');
    assert.equal(decision.action, 'read');
  });

  it('launches browser on reused pending (exist:true) too', async () => {
    const backend = await startJsonBackend(() => ({
      status: 200,
      body: pendingVerdict({
        sid: 'tc_stepup_reused',
        resource: 'system',
        action: 'create',
        exist: true,
      }),
    }));
    server = backend.server;
    process.env.TRANSCODES_BACKEND_URL = backend.url;

    const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command: 'mkdir temp4' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-stepup-challenged');
    if (decision.kind !== 'block-stepup-challenged') return;
    assert.equal(decision.browserLaunched, true);
    assert.equal(decision.sid, 'tc_stepup_reused');
  });
});
