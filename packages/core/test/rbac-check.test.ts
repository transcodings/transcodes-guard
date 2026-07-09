/**
 * Unit tests for the RBAC permission lookup (Phase 3 v2 Unit H, H1).
 *
 * Pins the fail-closed contract: a response whose payload has no item
 * matching the queried (resource, action) coordinate yields `null` — the
 * caller (evaluate.ts) maps null to level 2 (step-up forced) via `?? 2`.
 * Before H1 the lookup borrowed `payload[0]`'s permission, i.e. decided
 * with another coordinate's row of the matrix.
 */
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { StepupConfig } from '../src/stepup/config.js';
import { checkRbacPermission, evaluateAction } from '../src/stepup/rbac-check.js';
import { startUnreachableBackend } from './helpers/evaluate-harness.js';

describe('checkRbacPermission', () => {
  let server: Server;
  let baseUrl: string;
  // Per-test response program.
  let respond: () => { status: number; body: unknown };

  before(async () => {
    server = createServer((req, res) => {
      assert.equal(req.url, '/v1/auth/role/check-permission');
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
        statusCode: 200,
        payload,
        error: null,
      },
    };
  }

  it('returns the level of the exactly matching coordinate', async () => {
    respond = () =>
      payloadResponse([
        { permission: 1, resource: 'member', action: 'delete' },
      ]);
    assert.equal(await checkRbacPermission(config(), 'member', 'delete'), 1);
  });

  it('returns null when no payload item matches the coordinate (H1 pin)', async () => {
    // Pre-H1 this borrowed payload[0].permission (1 = allow) — the foreign
    // coordinate's row. Now it must be null → caller forces step-up (?? 2).
    respond = () =>
      payloadResponse([{ permission: 1, resource: 'other', action: 'read' }]);
    assert.equal(
      await checkRbacPermission(config(), 'member', 'delete'),
      null,
    );
  });

  it('returns null for an empty payload', async () => {
    respond = () => payloadResponse([]);
    assert.equal(
      await checkRbacPermission(config(), 'member', 'delete'),
      null,
    );
  });

  it('returns null when the matched permission is out of range', async () => {
    respond = () =>
      payloadResponse([
        { permission: 9, resource: 'member', action: 'delete' },
      ]);
    assert.equal(
      await checkRbacPermission(config(), 'member', 'delete'),
      null,
    );
  });

  it('returns null on a non-2xx response', async () => {
    respond = () => ({ status: 500, body: { error: 'boom' } });
    assert.equal(
      await checkRbacPermission(config(), 'member', 'delete'),
      null,
    );
  });
});

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

  it('parses a level-2 step-up verdict with grouping fields', async () => {
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
      group: 's_group1',
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

  it('flags a reused grouped session via exist=true', async () => {
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
      group: 's_group1',
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
