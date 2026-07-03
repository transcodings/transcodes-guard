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
import { after, before, beforeEach, describe, it } from 'node:test';
import { PLUGIN_VERSION } from '../src/build-info.js';
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

  it('maps proceed-by-verification with sid and toolName when present', () => {
    const decision: GateDecision = {
      kind: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
      block: { ...BLOCK, toolName: 'Bash' },
      consumeHere: true,
      fp: 'abcd1234abcd1234',
      sid: 'tc_stepup_join_key',
    };
    assert.deepEqual(decisionAuditEventOf(decision), {
      decision: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
      resource: 'system',
      action: 'delete',
      ruleId: 'rm-rf-root',
      fp: 'abcd1234abcd1234',
      sid: 'tc_stepup_join_key',
      toolName: 'Bash',
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

  it('maps block-stepup-create-failed with toolName but never a sid', () => {
    const decision: GateDecision = {
      kind: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
      block: { ...BLOCK, toolName: 'mcp__github__delete_repo' },
      failure: { ok: false, reason: 'create-failed' },
    };
    const event = decisionAuditEventOf(decision);
    assert.ok(event);
    assert.equal(event.toolName, 'mcp__github__delete_repo');
    // The session was never created — there is no sid to record.
    assert.equal(event.sid, undefined);
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
    delete process.env.TRANSCODES_GUARD_HOST;
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
      pluginVersion: PLUGIN_VERSION,
    });
    assert.ok(!JSON.stringify(body).includes('rm -rf'));
  });

  it('carries sid/toolName in metadata, still never the command string', async () => {
    await sendDecisionAudit(config(), {
      ...EVENT,
      decision: GATE_DECISION_KIND.PROCEED_BY_VERIFICATION,
      sid: 'tc_stepup_join_key',
      toolName: 'Bash',
    });
    assert.ok(received);
    const body = received.body as { metadata?: Record<string, unknown> };
    assert.equal(body.metadata?.sid, 'tc_stepup_join_key');
    assert.equal(body.metadata?.toolName, 'Bash');
    assert.ok(!JSON.stringify(received.body).includes('rm -rf'));
  });

  it('stamps host from TRANSCODES_GUARD_HOST when set, omits it otherwise', async () => {
    await sendDecisionAudit(config(), EVENT);
    assert.ok(received);
    let body = received.body as { metadata?: Record<string, unknown> };
    assert.ok(!('host' in (body.metadata ?? {})));

    process.env.TRANSCODES_GUARD_HOST = 'claude-code';
    try {
      await sendDecisionAudit(config(), EVENT);
    } finally {
      delete process.env.TRANSCODES_GUARD_HOST;
    }
    assert.ok(received);
    body = received.body as { metadata?: Record<string, unknown> };
    assert.equal(body.metadata?.host, 'claude-code');
    assert.equal(body.metadata?.pluginVersion, PLUGIN_VERSION);
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
