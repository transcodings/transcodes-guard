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
import type { StepupConfig } from '../src/config.js';
import { checkRbacPermission, evaluateAction } from '../src/rbac-check.js';

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

  it('parses consume_in_hook and reasoning from the evaluate payload', async () => {
    respond = () =>
      payloadResponse([
        {
          decision: 'stepup',
          resource: 'system',
          action: 'create',
          permission: 2,
          reasoning: 'mkdir creates a new directory.',
          consume_in_hook: true,
          sid: 'tc_stepup_test',
          url: 'https://auth.example/?sid=tc_stepup_test',
          expires_at: '2026-06-30T01:00:00.000Z',
        },
      ]);

    const verdict = await evaluateAction(config(), {
      toolName: 'Bash',
      toolInput: { command: 'mkdir temp4' },
      cwd: '/tmp',
      comment: 'Confirm',
    });

    assert.deepEqual(verdict, {
      permission: 2,
      resource: 'system',
      action: 'create',
      reasoning: 'mkdir creates a new directory.',
      consume_in_hook: true,
      sid: 'tc_stepup_test',
      url: 'https://auth.example/?sid=tc_stepup_test',
      expires_at: '2026-06-30T01:00:00.000Z',
    });
  });

  it('returns null when consume_in_hook is omitted (fail-closed)', async () => {
    respond = () =>
      payloadResponse([
        {
          permission: 1,
          resource: 'system',
          action: 'read',
          reasoning: '',
        },
      ]);

    const verdict = await evaluateAction(config(), {
      toolInput: { command: 'ls' },
    });

    assert.equal(verdict, null);
  });

  it('returns null when payload is missing (no envelope fallback)', async () => {
    respond = () => ({
      status: 200,
      body: {
        logId: 'x',
        success: true,
        statusCode: 201,
        error: null,
      },
    });

    const verdict = await evaluateAction(config(), {
      toolInput: { command: 'ls' },
    });

    assert.equal(verdict, null);
  });
});
