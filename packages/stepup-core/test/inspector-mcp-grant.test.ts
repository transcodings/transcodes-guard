/**
 * The read-only inspector surfaces the MCP grant + in-flight lock so the
 * agent (and tests) can confirm exemption state without side effects.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it } from 'vitest';
import { MCP_GRANT_TTL_MS } from '../src/config.js';
import { inspectStepupState } from '../src/inspector.js';
import { claimMcpInflight, writeMcpGrant } from '../src/mcp-grant.js';

const NOW = 1_800_000_000_000;

beforeEach(() => {
  process.env.HOME = mkdtempSync(path.join(os.tmpdir(), 'guard-inspect-grant-'));
});

describe('inspector — mcp grant / in-flight', () => {
  it('reports absent grant and lock on a clean state', () => {
    const s = inspectStepupState(NOW);
    assert.equal(s.mcp_grant.exists, false);
    assert.equal(s.mcp_inflight.exists, false);
  });

  it('surfaces an active grant with its TTL and expiry', () => {
    writeMcpGrant('sid-1', NOW);
    const active = inspectStepupState(NOW).mcp_grant;
    assert.equal(active.exists, true);
    if (active.exists) {
      assert.equal(active.sid, 'sid-1');
      assert.equal(active.granted_at_ms, NOW);
      assert.equal(active.ttl_ms, MCP_GRANT_TTL_MS);
      assert.equal(active.expired, false);
    }
    // Past the window the inspector reports it expired (read-only: not consumed).
    const lapsed = inspectStepupState(NOW + MCP_GRANT_TTL_MS).mcp_grant;
    assert.equal(lapsed.exists, true);
    if (lapsed.exists) assert.equal(lapsed.expired, true);
  });

  it('surfaces the in-flight lock', () => {
    claimMcpInflight({ sid: 'sid-2', browserUrl: 'https://auth/2' }, NOW);
    const lock = inspectStepupState(NOW).mcp_inflight;
    assert.equal(lock.exists, true);
    if (lock.exists) {
      assert.equal(lock.sid, 'sid-2');
      assert.equal(lock.browser_url, 'https://auth/2');
      assert.equal(lock.expired, false);
    }
  });
});
