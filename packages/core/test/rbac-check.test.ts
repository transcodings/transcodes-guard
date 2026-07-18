/**
 * Unit tests for the evaluate-based RBAC lookup.
 *
 * Pins the fail-closed contract: any failure (network / non-2xx / malformed)
 * yields a GuardEvaluateFailure, never a verdict — the caller (evaluate.ts)
 * maps a missing verdict to level 2 (step-up forced) via `?? 2`.
 */
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { StepupConfig } from '../src/stepup/config.js';
import { evaluateAction } from '../src/stepup/rbac-check.js';
import { startUnreachableBackend } from './helpers/evaluate-harness.js';

describe('evaluateAction', () => {
  let server: Server;
  let baseUrl: string;
  let respond: () => { status: number; body: unknown };

  before(async () => {
    server = createServer((req, res) => {
      assert.equal(req.url, '/v1/guard/evaluate');
      const { status, body } = respond();
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(() => server.close());

  function config(): StepupConfig {
    return {
      backendUrl: baseUrl,
      apiBaseV1: `${baseUrl}/v1`,
      token: 'test-token',
      organizationId: 'org-test',
      projectId: 'proj-test',
      memberId: 'member-test',
    };
  }

  function payloadResponse(payload: unknown) {
    return {
      status: 200,
      body: {
        logId: 'x',
        success: true,
        statusCode: 201,
        payload,
        error: null,
      },
    };
  }

  it('parses a level-2 step-up verdict with session fields', async () => {
    respond = () =>
      payloadResponse([
        {
          decision: 'stepup',
          resource: 'system',
          action: 'create',
          permission: 2,
          reasoning: 'mkdir creates a new directory.',
          summary: 'Create a new directory named temp4',
          provider: 'cursor',
          sid: 'tc_stepup_test',
          url: 'https://auth.example/?sid=tc_stepup_test',
          expires_at: '2026-06-30T01:00:00.000Z',
          exist: false,
          status: 'pending',
        },
      ]);

    const result = await evaluateAction(config(), {
      payload: {
        tool_name: 'Bash',
        tool_input: { command: 'mkdir temp4' },
      },
      cwd: '/tmp',
      provider: 'cursor',
    });

    assert.ok(result.ok);
    assert.deepEqual(result.verdict, {
      permission: 2,
      resource: 'system',
      action: 'create',
      reasoning: 'mkdir creates a new directory.',
      summary: 'Create a new directory named temp4',
      provider: 'cursor',
      sid: 'tc_stepup_test',
      url: 'https://auth.example/?sid=tc_stepup_test',
      expires_at: '2026-06-30T01:00:00.000Z',
      exist: false,
      status: 'pending',
    });
  });

  it('flags a reused coordinate session via exist=true', async () => {
    respond = () =>
      payloadResponse([
        {
          resource: 'system',
          action: 'create',
          permission: 2,
          reasoning: '',
          summary: 'Create a new directory',
          provider: 'claude',
          sid: 'tc_stepup_reused',
          url: 'https://auth.example/?sid=tc_stepup_reused',
          expires_at: '2026-06-30T01:00:00.000Z',
          exist: true,
          status: 'pending',
        },
      ]);

    const result = await evaluateAction(config(), {
      payload: { command: 'mkdir temp5' },
    });

    assert.ok(result.ok);
    assert.equal(result.verdict.exist, true);
    assert.equal(result.verdict.status, 'pending');
    assert.equal(result.verdict.sid, 'tc_stepup_reused');
  });

  it('parses a level-1 allow verdict with no step-up fields', async () => {
    respond = () =>
      payloadResponse([
        {
          permission: 1,
          resource: 'system',
          action: 'read',
          reasoning: '',
          summary: 'List directory contents',
          provider: null,
        },
      ]);

    const result = await evaluateAction(config(), {
      payload: { command: 'ls' },
    });

    assert.ok(result.ok);
    assert.deepEqual(result.verdict, {
      permission: 1,
      resource: 'system',
      action: 'read',
      reasoning: '',
      summary: 'List directory contents',
      provider: null,
      sid: null,
      url: null,
      expires_at: null,
      exist: false,
      status: null,
    });
  });

  it('falls back to provider null when the field is missing', async () => {
    respond = () =>
      payloadResponse([
        { permission: 1, resource: 'system', action: 'read', reasoning: '' },
      ]);

    const result = await evaluateAction(config(), {
      payload: { command: 'ls' },
    });

    assert.ok(result.ok);
    assert.equal(result.verdict.provider, null);
  });

  it('falls back to provider null on an unknown provider string', async () => {
    respond = () =>
      payloadResponse([
        {
          permission: 1,
          resource: 'system',
          action: 'read',
          reasoning: '',
          provider: 'mystery-host',
        },
      ]);

    const result = await evaluateAction(config(), {
      payload: { command: 'ls' },
    });

    assert.ok(result.ok);
    assert.equal(result.verdict.provider, null);
  });

  it('reports malformed when payload is missing (no envelope fallback)', async () => {
    respond = () => ({
      status: 200,
      body: {
        logId: 'x',
        success: true,
        statusCode: 201,
        error: null,
      },
    });

    const result = await evaluateAction(config(), {
      payload: { command: 'ls' },
    });

    assert.deepEqual(result, { ok: false, kind: 'malformed', status: 200 });
  });

  it('reports http failure with backend message and logId on non-2xx (#189)', async () => {
    respond = () => ({
      status: 404,
      body: {
        logId: '01JZLOG404',
        success: false,
        statusCode: 404,
        error: 'Not Found',
        message: 'member not found',
      },
    });

    const result = await evaluateAction(config(), {
      payload: { command: 'ls' },
    });

    assert.deepEqual(result, {
      ok: false,
      kind: 'http',
      status: 404,
      message: 'member not found; logId=01JZLOG404',
    });
  });

  it('reports network failure with status 0 when the backend is unreachable (#189)', async () => {
    // A live listener that destroys every connection — fetch rejects
    // (ECONNRESET) → envelope status 0, without the close-then-reuse port race.
    const dead = await startUnreachableBackend();

    try {
      const result = await evaluateAction(
        {
          ...config(),
          backendUrl: dead.url,
          apiBaseV1: `${dead.url}/v1`,
        },
        { payload: { command: 'ls' } },
      );

      assert.ok(!result.ok);
      assert.equal(result.kind, 'network');
      assert.equal(result.status, 0);
      assert.ok(result.message);
    } finally {
      await new Promise<void>((resolve) => dead.server.close(() => resolve()));
    }
  });
});
