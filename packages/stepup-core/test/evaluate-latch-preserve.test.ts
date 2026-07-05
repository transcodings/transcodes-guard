/**
 * Regression: a reused-pending /guard/evaluate verdict re-writes the latch
 * (to refresh authSid) but must carry over the prior createdAt/remindedCount.
 * Resetting them extends the latch TTL and restarts the Stop-reminder cap on
 * every retry of the same in-flight challenge.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { readLatchRecord, writeLatch } from '../src/latch.js';
import { rotatePromptSid } from '../src/sid.js';

function fakeMemberJwt(): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    oid: 'org-test',
    pid: 'proj-test',
    mid: 'member-test',
    aud: 'transcodes-mcp',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.x`;
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
    server = createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reusedPendingVerdict()));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    process.env.TRANSCODES_BACKEND_URL = `http://127.0.0.1:${address.port}`;
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
    home = mkdtempSync(path.join(tmpdir(), 'latch-preserve-'));
    process.env.HOME = home;
    const dir = path.join(home, '.transcodes');
    mkdirSync(path.join(dir, 'state'), { recursive: true });
    writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ token: fakeMemberJwt() }),
    );
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('keeps remindedCount and createdAt on a reused-pending verdict', async () => {
    const { evaluatePreToolUse } = await import('../src/evaluate.js');
    const sid = rotatePromptSid();
    const createdAt = Date.now() - 60_000;
    writeLatch(sid, 'system', 'create', 'tc_stepup_reused', createdAt, 2);

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command: 'mkdir temp4' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-stepup-challenged');
    const rec = readLatchRecord(sid, 'system', 'create');
    assert.ok(rec);
    assert.equal(rec.remindedCount, 2);
    assert.equal(rec.createdAt, createdAt);
    assert.equal(rec.authSid, 'tc_stepup_reused');
  });
});
