/**
 * Unit tests for the P0 gate hardening (F1 / F3 / F4).
 *
 *  - F1: `claimVerified` is an atomic single-winner claim — two callers racing
 *    the same fp yield the record to exactly one, so one MFA cannot authorise
 *    two executions on the verified fast path.
 *  - F3: `evaluatePreToolUse` re-issues an in-flight pending challenge instead
 *    of minting a second backend session for the same command.
 *  - F4: verified/pending writes are atomic (temp + rename), so a concurrent
 *    reader never destroys a record mid-write.
 *
 * State files resolve under `~/.transcodes/state`, so each test points HOME at
 * a throwaway dir (os.homedir() honours $HOME on Linux) and claims host=claude.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

let home: string;
const origHome = process.env.HOME;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'guard-race-'));
  process.env.HOME = home;
  process.env.TRANSCODES_GUARD_HOST = 'claude';
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

// Imported lazily AFTER HOME is set is unnecessary — os.homedir() is read at
// call time, not import time — so a normal top-level import is fine.

describe('F1 — claimVerified atomic single-winner', () => {
  it('returns the record to exactly one of two racing claimers', async () => {
    const { writeVerified, claimVerified } = await import('../src/store.js');
    const fp = '00112233aabbccdd';
    writeVerified({ sid: 'sid-race', verifiedAt: Date.now() }, fp);

    // Two claims for the same fp; only one may see the record.
    const first = claimVerified(fp);
    const second = claimVerified(fp);

    const winners = [first, second].filter((r) => r !== null);
    assert.equal(winners.length, 1, 'exactly one claimer wins');
    assert.equal(winners[0]?.sid, 'sid-race');

    // The on-disk record is gone after a successful claim.
    const { readVerified } = await import('../src/store.js');
    assert.equal(readVerified(fp), null);
  });

  it('returns null when no record exists', async () => {
    const { claimVerified } = await import('../src/store.js');
    assert.equal(claimVerified('deadbeefdeadbeef'), null);
  });

  it('rejects an expired record on claim', async () => {
    const { writeVerified, claimVerified } = await import('../src/store.js');
    const fp = 'expaaaabbbbcccc0';
    // 11 minutes old (TTL is 10m) → expired.
    writeVerified({ sid: 'sid-old', verifiedAt: Date.now() - 11 * 60_000 }, fp);
    assert.equal(claimVerified(fp), null);
  });
});

describe('F4 — atomic writes leave no torn file', () => {
  it('writeVerified persists a valid, readable record', async () => {
    const { writeVerified, readVerified } = await import('../src/store.js');
    const fp = 'atomic1234567890';
    writeVerified({ sid: 'sid-atomic', verifiedAt: Date.now() }, fp);
    const back = readVerified(fp);
    assert.equal(back?.sid, 'sid-atomic');
  });

  it('leaves no leftover .tmp files in the state dir', async () => {
    const { writeVerified } = await import('../src/store.js');
    const { cacheDir } = await import('../src/store.js');
    const fp = 'nostrayfiles0000';
    writeVerified({ sid: 'sid-x', verifiedAt: Date.now() }, fp);
    const stray = readdirSync(cacheDir()).filter((n) => n.includes('.tmp.'));
    assert.deepEqual(stray, [], 'no temp files left behind');
  });
});

describe('F3 — evaluatePreToolUse reuses an in-flight pending', () => {
  it('re-issues the existing sid instead of a new session', async () => {
    const { writePending } = await import('../src/pending.js');
    const { evaluatePreToolUse } = await import('../src/evaluate.js');
    const { fingerprintOf } = await import('../src/gate.js');

    // A token must exist for the flow to pass the no-token guard and reach the
    // pending-reuse branch. Write a throwaway config.json under the temp HOME.
    const cfgDir = path.join(home, '.transcodes');
    rmSync(cfgDir, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(cfgDir, { recursive: true });
    // Minimal well-formed member JWT is not required: resolveToken only needs a
    // non-empty active token string to pass the guard; loadStepupConfig would
    // parse it, but the pending-reuse branch returns BEFORE loadStepupConfig.
    writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({ token: 'tkn', token_list: [{ token: 'tkn' }] }),
    );

    const command = 'rm -rf /tmp/whatever';
    const fp = fingerprintOf(command);
    writePending({
      sid: 'sid-inflight',
      command,
      reason: 'test',
      browserUrl: 'https://example.test/step-up/sid-inflight',
      createdAt: Date.now(),
      status: 'pending',
      fp,
    });

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-stepup-challenged');
    if (decision.kind === 'block-stepup-challenged') {
      assert.equal(decision.sid, 'sid-inflight', 'reused the in-flight sid');
    }
  });
});
