/**
 * Regression for issue #189 — a step-up deny must be diagnosable.
 *
 * Scenarios pinned against a synthetic external MCP mutation
 * (`mcp__external__create_resource`), the hook-gated path from the issue:
 *  (a) backend 200 + permission=2 + sid/url    → challenged deny CARRIES the sid.
 *  (b) backend non-2xx                         → create-failed deny carries
 *      "HTTP <status>" + backend message/logId in failure.detail.
 *  (c) backend 200 + permission=2, sid missing → create-failed deny names the
 *      backend anomaly (sid/url missing), distinct from (b).
 *  (d) backend unreachable                     → create-failed deny says so.
 * Before this fix (b)–(d) all rendered the bare "Step-up MFA session could
 * not be started." with no cause. Fail-closed is unchanged: all deny.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { formatStepupCreateFailedReason } from '../src/contract/messages.js';
import { rotatePromptGroup } from '../src/stepup/sid.js';
import {
  makeHomeSandbox,
  startJsonBackend,
  startUnreachableBackend,
} from './helpers/evaluate-harness.js';

const EXTERNAL_MCP_CALL = {
  toolName: 'mcp__external__create_resource',
  toolInput: { name: 'qa-page' },
  cwd: '/tmp',
};

function stepupPayloadItem(overrides: Record<string, unknown> = {}) {
  return {
    permission: 2,
    resource: 'notion',
    action: 'create',
    reasoning: 'External MCP mutation.',
    summary: 'Create a resource via external MCP',
    provider: 'codex',
    sid: 'tc_stepup_189',
    url: 'https://auth.example/?sid=tc_stepup_189',
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    // exist:true (reused pending) keeps openBrowser out of the test run.
    exist: true,
    status: 'pending',
    ...overrides,
  };
}

describe('external MCP step-up deny diagnosability (#189)', () => {
  let server: Server;
  let respond: () => { status: number; body: unknown };
  let home = '';
  const origHome = process.env.HOME;
  const origUrl = process.env.TRANSCODES_BACKEND_URL;

  before(async () => {
    const backend = await startJsonBackend(() => respond());
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
    home = makeHomeSandbox('evaluate-189-');
    rotatePromptGroup();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('(a) challenged deny carries the backend-minted sid and url', async () => {
    respond = () => ({
      status: 200,
      body: {
        logId: 'x',
        success: true,
        statusCode: 201,
        error: null,
        payload: [stepupPayloadItem()],
      },
    });

    const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
    const decision = await evaluatePreToolUse(EXTERNAL_MCP_CALL);

    assert.equal(decision.kind, 'block-stepup-challenged');
    if (decision.kind !== 'block-stepup-challenged') return;
    assert.equal(decision.sid, 'tc_stepup_189');
    assert.equal(decision.browserUrl, 'https://auth.example/?sid=tc_stepup_189');
  });

  it('(b) non-2xx evaluate surfaces HTTP status + backend message in the deny', async () => {
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

    const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
    const decision = await evaluatePreToolUse(EXTERNAL_MCP_CALL);

    assert.equal(decision.kind, 'block-stepup-create-failed');
    if (decision.kind !== 'block-stepup-create-failed') return;
    // Backend-side failure keeps the audited 'create-failed' reason
    // (decisionAuditEventOf records only this reason).
    assert.equal(decision.failure.reason, 'create-failed');
    assert.ok(decision.failure.detail?.includes('HTTP 404'));
    assert.ok(decision.failure.detail?.includes('member not found'));
    assert.ok(decision.failure.detail?.includes('logId=01JZLOG404'));
    // End-to-end: the agent-facing reason line renders the detail.
    assert.ok(formatStepupCreateFailedReason(decision).includes('HTTP 404'));
  });

  it('(c) a 2xx permission=2 verdict without sid names the backend anomaly', async () => {
    respond = () => ({
      status: 200,
      body: {
        logId: 'x',
        success: true,
        statusCode: 201,
        error: null,
        payload: [stepupPayloadItem({ sid: undefined, url: undefined })],
      },
    });

    const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
    const decision = await evaluatePreToolUse(EXTERNAL_MCP_CALL);

    assert.equal(decision.kind, 'block-stepup-create-failed');
    if (decision.kind !== 'block-stepup-create-failed') return;
    assert.equal(decision.failure.reason, 'create-failed');
    assert.ok(decision.failure.detail?.includes('sid/url missing'));
  });

  it('(d) unreachable backend says so in the deny detail', async () => {
    const dead = await startUnreachableBackend();
    const prevUrl = process.env.TRANSCODES_BACKEND_URL;
    process.env.TRANSCODES_BACKEND_URL = dead.url;

    try {
      const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
      const decision = await evaluatePreToolUse(EXTERNAL_MCP_CALL);

      assert.equal(decision.kind, 'block-stepup-create-failed');
      if (decision.kind !== 'block-stepup-create-failed') return;
      assert.equal(decision.failure.reason, 'create-failed');
      assert.ok(decision.failure.detail?.includes('backend unreachable'));
    } finally {
      process.env.TRANSCODES_BACKEND_URL = prevUrl;
      await new Promise<void>((resolve) => dead.server.close(() => resolve()));
    }
  });
});
