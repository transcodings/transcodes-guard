/**
 * Unit tests for the gate decision audit (Phase 3 v2 Unit H, H2).
 *
 * Pins the two invariants that matter: the send never throws/blocks beyond
 * its timeout, and the payload carries coordinates/decision/rule id/fp but
 * NEVER the raw command string.
 */
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { StepupConfig } from '../src/config.js';
import {
  DECISION_AUDIT_TAG,
  decisionAuditEventOf,
  sendDecisionAudit,
} from '../src/decision-audit.js';
import type { GateDecision } from '../src/evaluate.js';

const BLOCK = {
  reason: 'matched system pattern `rm-rf-root` — recursive removal',
  command: 'rm -rf / --secret-arg',
  ruleId: 'rm-rf-root',
  stepupResource: 'system',
  stepupAction: 'delete',
} as const;

describe('decisionAuditEventOf', () => {
  it('maps pass to null (not audited)', () => {
    assert.equal(decisionAuditEventOf({ kind: 'pass' }), null);
  });

  it('maps an allow decision with its fp', () => {
    const decision: GateDecision = {
      kind: 'allow',
      block: BLOCK,
      consumeHere: true,
      fp: 'abcd1234abcd1234',
    };
    assert.deepEqual(decisionAuditEventOf(decision), {
      decision: 'allow',
      resource: 'system',
      action: 'delete',
      ruleId: 'rm-rf-root',
      fp: 'abcd1234abcd1234',
    });
  });

  it('maps deny-stepup-pending with the pending fp', () => {
    const decision: GateDecision = {
      kind: 'deny-stepup-pending',
      block: BLOCK,
      sid: 'tc_stepup_x',
      browserUrl: 'http://localhost/x',
      browserLaunched: false,
      pending: {
        sid: 'tc_stepup_x',
        command: BLOCK.command,
        reason: BLOCK.reason,
        browserUrl: 'http://localhost/x',
        createdAt: 0,
        status: 'pending',
        fp: 'ffff0000ffff0000',
      },
    };
    const event = decisionAuditEventOf(decision);
    assert.ok(event);
    assert.equal(event.decision, 'deny-stepup-pending');
    assert.equal(event.fp, 'ffff0000ffff0000');
  });
});

describe('sendDecisionAudit', () => {
  let server: Server;
  let baseUrl: string;
  let received: { url: string; body: unknown } | null = null;
  let hangMs = 0;

  before(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        received = { url: req.url ?? '', body: JSON.parse(raw) };
        setTimeout(() => {
          res.statusCode = 201;
          res.setHeader('content-type', 'application/json');
          res.end('{}');
        }, hangMs);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(() => server.close());

  beforeEach(() => {
    received = null;
    hangMs = 0;
  });

  function config(url = baseUrl): StepupConfig {
    return {
      backendUrl: url,
      apiBaseV1: `${url}/v1`,
      token: 'test-token',
      organizationId: 'org-test',
      projectId: 'proj-test',
      memberId: 'member-test',
    };
  }

  const EVENT = {
    decision: 'deny-rbac-denied' as const,
    resource: 'system',
    action: 'delete' as const,
    ruleId: 'rm-rf-root',
  };

  it('posts tag + scope + event metadata, never the command string', async () => {
    await sendDecisionAudit(config(), EVENT);
    assert.ok(received);
    assert.equal(received.url, '/v1/audit/logs');
    const body = received.body as Record<string, unknown>;
    assert.equal(body.tag, DECISION_AUDIT_TAG);
    assert.equal(body.project_id, 'proj-test');
    assert.equal(body.member_id, 'member-test');
    assert.equal(body.severity, 'medium');
    assert.deepEqual(body.metadata, EVENT);
    assert.ok(!JSON.stringify(body).includes('rm -rf'));
  });

  it('uses severity low for allow decisions', async () => {
    await sendDecisionAudit(config(), { ...EVENT, decision: 'allow' });
    assert.ok(received);
    assert.equal((received.body as { severity?: string }).severity, 'low');
  });

  it('resolves silently when the backend is unreachable', async () => {
    await sendDecisionAudit(config('http://127.0.0.1:1'), EVENT);
  });

  it('gives up at the timeout instead of waiting out a hung backend', async () => {
    hangMs = 5_000;
    const started = Date.now();
    await sendDecisionAudit(config(), EVENT, { timeoutMs: 100 });
    assert.ok(Date.now() - started < 2_000);
  });
});
