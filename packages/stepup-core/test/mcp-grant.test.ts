/**
 * Unit tests for the MCP-only exemption layer (mcp-grant.ts): the fixed
 * 5-minute grant and the global in-flight lock. Filesystem is isolated per
 * test via a fresh $HOME so cacheDir() resolves into a throwaway directory.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it } from 'vitest';
import { MCP_GRANT_TTL_MS } from '../src/config.js';
import {
  claimMcpInflight,
  clearMcpInflight,
  consumeMcpGrant,
  mcpGrantActive,
  readMcpGrant,
  readMcpInflight,
  writeMcpGrant,
} from '../src/mcp-grant.js';

const NOW = 1_800_000_000_000;

beforeEach(() => {
  // Fresh throwaway HOME per test → cacheDir() (~/.transcodes/state) isolated.
  process.env.HOME = mkdtempSync(path.join(os.tmpdir(), 'guard-mcp-grant-'));
});

describe('mcp grant', () => {
  it('writes then reads back a grant within the window', () => {
    writeMcpGrant('sid-1', NOW);
    const rec = readMcpGrant(NOW);
    assert.equal(rec?.sid, 'sid-1');
    assert.equal(rec?.grantedAt, NOW);
    assert.equal(mcpGrantActive(NOW), true);
  });

  it('is still active 1ms before the TTL boundary', () => {
    writeMcpGrant('sid-1', NOW);
    assert.equal(mcpGrantActive(NOW + MCP_GRANT_TTL_MS - 1), true);
  });

  it('expires exactly at the TTL boundary and self-heals on read', () => {
    writeMcpGrant('sid-1', NOW);
    // At grantedAt + TTL the grant is no longer active (>= boundary).
    assert.equal(readMcpGrant(NOW + MCP_GRANT_TTL_MS), null);
    // The expired record was consumed, so even a fresh read at NOW is empty.
    assert.equal(readMcpGrant(NOW), null);
  });

  it('is non-sliding: a later write does not extend the window', () => {
    writeMcpGrant('sid-1', NOW);
    // A second write a minute later (e.g. another MCP call passing the gate)
    // must NOT move grantedAt forward.
    writeMcpGrant('sid-2', NOW + 60_000);
    const rec = readMcpGrant(NOW + 60_000);
    assert.equal(rec?.grantedAt, NOW, 'grantedAt must stay at the first write');
    assert.equal(rec?.sid, 'sid-1', 'the original sid is retained');
    // And the window still ends at the ORIGINAL grantedAt + TTL.
    assert.equal(mcpGrantActive(NOW + MCP_GRANT_TTL_MS - 1), true);
    assert.equal(mcpGrantActive(NOW + MCP_GRANT_TTL_MS), false);
  });

  it('re-arms after an explicit consume', () => {
    writeMcpGrant('sid-1', NOW);
    consumeMcpGrant();
    assert.equal(mcpGrantActive(NOW), false);
    writeMcpGrant('sid-2', NOW + 1_000);
    assert.equal(readMcpGrant(NOW + 1_000)?.sid, 'sid-2');
  });
});

describe('mcp in-flight lock', () => {
  const rec = { sid: 'sid-1', browserUrl: 'https://example/auth' };

  it('first claim succeeds and persists the record', () => {
    const r = claimMcpInflight(rec, NOW);
    assert.equal(r.claimed, true);
    const stored = readMcpInflight(NOW);
    assert.equal(stored?.sid, 'sid-1');
    assert.equal(stored?.browserUrl, 'https://example/auth');
    assert.equal(stored?.startedAt, NOW);
  });

  it('a second concurrent claim is rejected with the existing record', () => {
    claimMcpInflight(rec, NOW);
    const r = claimMcpInflight(
      { sid: 'sid-2', browserUrl: 'https://example/other' },
      NOW + 10,
    );
    assert.equal(r.claimed, false);
    if (!r.claimed) {
      // The winner's session is returned so the caller can defer to it.
      assert.equal(r.existing.sid, 'sid-1');
    }
  });

  it('a fresh claim succeeds after the lock expires (no deadlock)', () => {
    claimMcpInflight(rec, NOW);
    // Past the backend session TTL the stale lock is reaped and reclaimable.
    const r = claimMcpInflight(
      { sid: 'sid-2', browserUrl: 'https://example/other' },
      NOW + 11 * 60_000,
    );
    assert.equal(r.claimed, true);
    assert.equal(readMcpInflight(NOW + 11 * 60_000)?.sid, 'sid-2');
  });

  it('honours the backend expiresAt over the default TTL', () => {
    const expiresAt = new Date(NOW + 30_000).toISOString();
    claimMcpInflight({ ...rec, expiresAt }, NOW);
    // 31s later the backend window has closed even though the default TTL has not.
    assert.equal(readMcpInflight(NOW + 31_000), null);
  });

  it('clear removes the lock', () => {
    claimMcpInflight(rec, NOW);
    clearMcpInflight();
    assert.equal(readMcpInflight(NOW), null);
  });
});
