/**
 * Regression: a reused-pending /guard/evaluate verdict re-writes the latch
 * (to refresh sid) but must carry over the prior createdAt/remindedCount.
 * Resetting them extends the latch TTL and restarts the Stop-reminder cap on
 * every retry of the same in-flight challenge.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { readLatchRecord, writeLatch } from '../src/stepup/latch.js';
import { rotatePromptGroup } from '../src/stepup/sid.js';
import { makeHomeSandbox, startJsonBackend } from './helpers/evaluate-harness.js';

function freshPendingVerdict(sid: string) {
  return {
    logId: 'x',
    success: true,
    statusCode: 201,
    error: null,
    payload: [
      {
        permission: 2,
        resource: 'gmail',
        action: 'read',
        reasoning: '',
        summary: 'Read gmail messages',
        provider: 'cursor',
        sid,
        url: `https://auth.example/?sid=${sid}`,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        exist: false,
        status: 'pending',
      },
    ],
  };
}

function reusedPendingVerdict() {
  return {
    logId: 'x',
    success: true,
    statusCode: 201,
    error: null,
    payload: [
      {
        permission: 2,
        resource: 'system',
        action: 'create',
        reasoning: '',
        summary: 'Create a new directory',
        provider: 'claude',
        sid: 'tc_stepup_reused',
        url: 'https://auth.example/?sid=tc_stepup_reused',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        exist: true,
        status: 'pending',
      },
    ],
  };
}

describe('reused-pending latch rewrite', () => {
  let server: Server;
  let home = '';
  const origHome = process.env.HOME;
  const origUrl = process.env.TRANSCODES_BACKEND_URL;

  before(async () => {
    const backend = await startJsonBackend(() => ({
      status: 200,
      body: reusedPendingVerdict(),
    }));
    server = backend.server;
    process.env.TRANSCODES_BACKEND_URL = backend.url;
  });

  after(() => {
    server.close();
    if (origUrl === undefined) {
      delete process.env.TRANSCODES_BACKEND_URL;
    } else {
      process.env.TRANSCODES_BACKEND_URL = origUrl;
    }
  });

  beforeEach(() => {
    home = makeHomeSandbox('latch-preserve-');
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('writes latch sid on first pending challenge', async () => {
    server.close();
    const backend = await startJsonBackend(() => ({
      status: 200,
      body: freshPendingVerdict('tc_stepup_fresh'),
    }));
    server = backend.server;
    process.env.TRANSCODES_BACKEND_URL = backend.url;

    const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
    const group = rotatePromptGroup();

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command: 'curl gmail' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-stepup-challenged');
    if (decision.kind !== 'block-stepup-challenged') return;
    assert.equal(decision.sid, 'tc_stepup_fresh');

    const rec = readLatchRecord(group, 'gmail', 'read');
    assert.ok(rec);
    assert.equal(rec.sid, 'tc_stepup_fresh');
  });

  it('keeps remindedCount and createdAt on a reused-pending verdict', async () => {
    const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
    const group = rotatePromptGroup();
    const createdAt = Date.now() - 60_000;
    writeLatch(group, 'system', 'create', 'tc_stepup_reused', createdAt, 2);

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command: 'mkdir temp4' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-stepup-challenged');
    const rec = readLatchRecord(group, 'system', 'create');
    assert.ok(rec);
    assert.equal(rec.remindedCount, 2);
    assert.equal(rec.createdAt, createdAt);
    assert.equal(rec.sid, 'tc_stepup_reused');
  });
});
