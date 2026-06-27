/**
 * Unit tests for the gate decision audit (Phase 3 v2 Unit H, H2).
 *
 * Pins the invariants that matter: the send never throws/blocks beyond
 * its timeout, the payload carries coordinates/decision/rule id/fp but
 * NEVER the raw command string. Also pins the narrowed audit scope: only
 * `proceed-by-verification` and `block-stepup-create-failed` (w/
 * `reason === 'create-failed'`) are recorded; every other kind returns null.
 * Finally, pins the wire-translation seam: the backend receives the *legacy*
 * kind strings, not the renamed local kinds.
 */
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import type { StepupConfig } from '../src/config.js';
import {
  DECISION_AUDIT_TAG,
  decisionAuditEventOf,
  sendDecisionAudit,
} from '../src/decision-audit.js';
import { GATE_DECISION_KIND, type GateDecision } from '../src/evaluate.js';

const BLOCK = {
  reason: 'matched system pattern `rm-rf-root` — recursive removal',
  command: 'rm -rf / --secret-arg',
  ruleId: 'rm-rf-root',
  stepupResource: 'system',
  stepupAction: 'delete',
} as const;

describe('decisionAuditEventOf — recorded kinds', () => {
  it('maps proceed-by-verification with its fp', () => {
    const decision: GateDecision = {
      kind: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
      block: BLOCK,
      consumeHere: true,
      fp: 'abcd1234abcd1234',
    };
    assert.deepEqual(decisionAuditEventOf(decision), {
      decision: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
      resource: 'system',
      action: 'delete',
      ruleId: 'rm-rf-root',
      fp: 'abcd1234abcd1234',
    });
  });

  it('maps proceed-by-verification without fp (MCP system rule path)', () => {
    const decision: GateDecision = {
      kind: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
      block: BLOCK,
      consumeHere: false,
    };
    const event = decisionAuditEventOf(decision);
    assert.ok(event);
    assert.equal(event.decision, GATE_DECISION_KIND.PROCEED_BY_VERIFICATION);
    assert.equal(event.resource, 'system');
    assert.equal(event.action, 'delete');
    assert.equal(event.ruleId, 'rm-rf-root');
    assert.equal(event.fp, undefined);
  });

  it('maps block-stepup-create-failed (reason create-failed) without fp', () => {
    const decision: GateDecision = {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
      block: BLOCK,
      failure: { ok: false, reason: 'create-failed', detail: 'status 503' },
    };
    assert.deepEqual(decisionAuditEventOf(decision), {
      decision: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
      resource: 'system',
      action: 'delete',
      ruleId: 'rm-rf-root',
    });
  });
});

describe('decisionAuditEventOf — excluded kinds return null', () => {
  it('excludes proceed-ungated', () => {
    assert.equal(
      decisionAuditEventOf({ kind: GATE_DECISION_KIND.PROCEED_UNGATED }),
      null,
    );
  });

  it('excludes proceed-by-policy (RBAC grant, no step-up)', () => {
    assert.equal(
      decisionAuditEventOf({
        kind: GATE_DECISION_KIND.PROCEED_BY_POLICY,
        block: BLOCK,
        resource: 'system',
        action: 'delete',
      }),
      null,
    );
  });

  it('excludes block-no-token', () => {
    assert.equal(
      decisionAuditEventOf({
        kind: GATE_DECISION_KIND.BLOCK_NO_TOKEN,
        block: BLOCK,
      }),
      null,
    );
  });

  it('excludes block-by-policy (RBAC deny)', () => {
    assert.equal(
      decisionAuditEventOf({
        kind: GATE_DECISION_KIND.BLOCK_BY_POLICY,
        block: BLOCK,
        resource: 'system',
        action: 'delete',
      }),
      null,
    );
  });

  it('excludes block-stepup-challenged (attempt, not an outcome)', () => {
    const decision: GateDecision = {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED,
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
    assert.equal(decisionAuditEventOf(decision), null);
  });

  it('excludes block-stepup-create-failed when reason is no-token (race)', () => {
    const decision: GateDecision = {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
      block: BLOCK,
      failure: { ok: false, reason: 'no-token' },
    };
    assert.equal(decisionAuditEventOf(decision), null);
  });

  it('excludes block-stepup-create-failed when reason is error (local config)', () => {
    const decision: GateDecision = {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
      block: BLOCK,
      failure: { ok: false, reason: 'error', detail: 'config load failed' },
    };
    assert.equal(decisionAuditEventOf(decision), null);
  });
});

describe('sendDecisionAudit', () => {
  let server: Server;
  let baseUrl: string;
  let received: { url: string; body: unknown } | null = null;
  let hangMs = 0;

  beforeAll(async () => {
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

  afterAll(() => server.close());

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
    decision: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
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
    assert.deepEqual(body.metadata, {
      ...EVENT,
      decision: 'deny-stepup-failure', // legacy wire value
    });
    assert.ok(!JSON.stringify(body).includes('rm -rf'));
  });

  it('translates proceed-by-verification to the legacy wire value "allow"', async () => {
    await sendDecisionAudit(config(), {
      ...EVENT,
      decision: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
    });
    assert.ok(received);
    const body = received.body as { severity?: string; metadata?: { decision?: string } };
    assert.equal(body.severity, 'low');
    assert.equal(body.metadata?.decision, 'allow');
  });

  it('translates block-stepup-create-failed to the legacy wire value "deny-stepup-failure"', async () => {
    await sendDecisionAudit(config(), EVENT);
    assert.ok(received);
    const body = received.body as { metadata?: { decision?: string } };
    assert.equal(body.metadata?.decision, 'deny-stepup-failure');
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
