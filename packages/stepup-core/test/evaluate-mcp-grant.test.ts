/**
 * Unit tests for the MCP exemption wiring inside evaluatePreToolUse:
 *   - grant arming on the first verified MCP hit,
 *   - grant short-circuit (no new step-up while a grant is live),
 *   - in-flight burst suppression (a second concurrent MCP call defers),
 *   - RBAC level-0 is never bypassed by a grant,
 *   - Bash is wholly unaffected (still steps up every time).
 *
 * The backend/token/danger-rule collaborators are mocked at the module
 * boundary so the test exercises only evaluate's branch logic; the real
 * grant/in-flight files (mcp-grant.ts) are used unmocked, isolated per test
 * via a fresh $HOME.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it, vi } from 'vitest';

// --- mocked collaborators -------------------------------------------------
const state = vi.hoisted(() => ({
  rbacLevel: 2 as 0 | 1 | 2,
  verified: null as { sid: string; verifiedAt: number } | null,
  recheck: 'trust' as 'trust' | 'reauth',
  hasToken: true,
  requestStepup: { ok: true, sid: 'sid-new', browserUrl: 'https://auth/new', launched: true },
  requestStepupCalls: 0,
}));

vi.mock('../src/token-store.js', () => ({
  resolveToken: () => ({ token: state.hasToken ? 'tok' : undefined }),
}));
vi.mock('../src/config.js', async (orig) => ({
  ...(await orig<typeof import('../src/config.js')>()),
  loadStepupConfig: () => ({
    backendUrl: 'http://x',
    apiBaseV1: 'http://x/v1',
    token: 'tok',
    organizationId: 'o',
    projectId: 'p',
    memberId: 'm',
  }),
}));
vi.mock('../src/rbac-check.js', () => ({
  checkRbacPermission: async () => state.rbacLevel,
}));
vi.mock('../src/session.js', () => ({
  pollStepupSession: async () => ({
    envelope: { ok: true, status: 200 },
    status: state.recheck === 'trust' ? 'verified' : 'pending',
  }),
}));
vi.mock('../src/store.js', async (orig) => ({
  ...(await orig<typeof import('../src/store.js')>()),
  readVerified: () => state.verified,
  consumeVerified: () => {},
}));
vi.mock('../src/gate.js', async (orig) => ({
  ...(await orig<typeof import('../src/gate.js')>()),
  requestStepup: async () => {
    state.requestStepupCalls++;
    return state.requestStepup;
  },
}));

import { evaluatePreToolUse, GATE_DECISION_KIND } from '../src/evaluate.js';
import {
  claimMcpInflight,
  mcpGrantActive,
  readMcpInflight,
  writeMcpGrant,
} from '../src/mcp-grant.js';

// An MCP tool call that matches a system tool-rule. The danger-patterns
// system bundle ships a rule for the transcodes-guard member-deletion tool;
// we use a tool name guaranteed to match a system rule via the real loader.
// To stay independent of bundle contents, we instead drive a Bash command for
// the Bash-regression test and an MCP call whose rule we assert via behaviour.

const MCP_INPUT = {
  toolName: 'mcp__plugin_transcodes-guard_transcodes-guard__retire_member',
  toolInput: { member_id: 'mem-1' },
  cwd: '/repo',
};
const BASH_INPUT = {
  toolName: 'Bash',
  toolInput: { command: 'rm -rf /important' },
  cwd: '/repo',
};

beforeEach(() => {
  process.env.HOME = mkdtempSync(path.join(os.tmpdir(), 'guard-eval-grant-'));
  state.rbacLevel = 2;
  state.verified = null;
  state.recheck = 'trust';
  state.hasToken = true;
  state.requestStepupCalls = 0;
});

describe('evaluate — MCP grant arming', () => {
  it('arms the grant on the first verified MCP hit and clears in-flight', async () => {
    // Simulate a step-up already in flight (claimed when the challenge fired).
    claimMcpInflight({ sid: 'sid-x', browserUrl: 'https://auth/x' });
    state.verified = { sid: 'sid-x', verifiedAt: Date.now() };

    const d = await evaluatePreToolUse(MCP_INPUT);
    assert.equal(d.kind, GATE_DECISION_KIND.PROCEED_BY_VERIFICATION);
    assert.equal(mcpGrantActive(), true, 'grant opened');
    assert.equal(readMcpInflight(), null, 'in-flight lock released');
  });
});

describe('evaluate — MCP grant short-circuit', () => {
  it('passes a later MCP call within the grant without a new step-up', async () => {
    writeMcpGrant('sid-prev');
    state.verified = null; // no verified record for THIS command's fp

    const d = await evaluatePreToolUse(MCP_INPUT);
    assert.equal(d.kind, GATE_DECISION_KIND.PROCEED_BY_VERIFICATION);
    assert.equal(state.requestStepupCalls, 0, 'no new step-up session created');
  });

  it('still hard-denies RBAC level 0 even with an active grant', async () => {
    writeMcpGrant('sid-prev');
    state.verified = null;
    state.rbacLevel = 0;

    const d = await evaluatePreToolUse(MCP_INPUT);
    assert.equal(d.kind, GATE_DECISION_KIND.BLOCK_BY_POLICY);
  });
});

describe('evaluate — MCP in-flight burst suppression', () => {
  it('defers a second concurrent MCP call to the in-flight session', async () => {
    // A prior MCP step-up is mid-flight, no grant yet (auth not completed).
    claimMcpInflight({ sid: 'sid-busy', browserUrl: 'https://auth/busy' });
    state.verified = null;

    const d = await evaluatePreToolUse(MCP_INPUT);
    assert.equal(d.kind, GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED);
    if (d.kind === GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED) {
      assert.equal(d.sid, 'sid-busy', 'reuses the in-flight sid');
      assert.equal(d.browserLaunched, false, 'no second tab opened');
    }
    assert.equal(state.requestStepupCalls, 0, 'no second session created');
  });

  it('creates a session and claims the lock when nothing is in flight', async () => {
    state.verified = null;
    const d = await evaluatePreToolUse(MCP_INPUT);
    assert.equal(d.kind, GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED);
    assert.equal(state.requestStepupCalls, 1);
    assert.equal(readMcpInflight()?.sid, 'sid-new', 'in-flight lock claimed');
  });
});

describe('evaluate — Bash is unaffected by the MCP grant', () => {
  it('steps up a Bash command even while an MCP grant is active', async () => {
    writeMcpGrant('sid-prev'); // a live MCP grant must NOT exempt Bash
    state.verified = null;

    const d = await evaluatePreToolUse(BASH_INPUT);
    assert.equal(d.kind, GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED);
    assert.equal(state.requestStepupCalls, 1, 'Bash always creates a session');
    // Bash must not touch the MCP in-flight lock.
    assert.equal(readMcpInflight(), null);
  });
});
