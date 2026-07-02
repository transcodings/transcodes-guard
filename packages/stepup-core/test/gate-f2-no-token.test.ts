/**
 * Unit tests for F2 — the token-less verified fast-path fails closed.
 *
 * Without a token `recheckVerifiedSid` cannot run the forgery re-poll, so a
 * fabricated `stepup-verified.<fp>.json` must NOT be trusted: the gate falls
 * back to BLOCK_NO_TOKEN. The explicit TRANSCODES_GUARD_TEST_TRUST=1 flag
 * (token-less CI smokes only) restores the old trust behaviour.
 *
 * State files resolve under `~/.transcodes/state`, so each test points HOME at
 * a throwaway dir (os.homedir() honours $HOME on Linux) and claims host=claude.
 * The temp HOME has no `~/.transcodes/config.json`, which IS the token-less
 * condition (the config file is the single token source — no env fallback).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

let home: string;
const origHome = process.env.HOME;
const origFlag = process.env.TRANSCODES_GUARD_TEST_TRUST;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'guard-f2-'));
  process.env.HOME = home;
  process.env.TRANSCODES_GUARD_HOST = 'claude';
  delete process.env.TRANSCODES_GUARD_TEST_TRUST;
});

afterEach(() => {
  process.env.HOME = origHome;
  if (origFlag === undefined) delete process.env.TRANSCODES_GUARD_TEST_TRUST;
  else process.env.TRANSCODES_GUARD_TEST_TRUST = origFlag;
  rmSync(home, { recursive: true, force: true });
});

describe('F2 — token-less fast-path fails closed', () => {
  it('blocks with block-no-token instead of trusting a planted record', async () => {
    const { writeVerified, readVerified } = await import('../src/store.js');
    const { evaluatePreToolUse } = await import('../src/evaluate.js');
    const { fingerprintOf } = await import('../src/gate.js');

    const command = 'rm -rf /tmp/f2';
    const fp = fingerprintOf(command);
    writeVerified({ sid: 'sid-forged', verifiedAt: Date.now() }, fp);

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
    // The untrusted record was consumed by the atomic claim — nothing left to
    // replay on a retry.
    assert.equal(readVerified(fp), null);
  });

  it('TRANSCODES_GUARD_TEST_TRUST=1 restores the token-less allow (CI smokes)', async () => {
    process.env.TRANSCODES_GUARD_TEST_TRUST = '1';
    const { writeVerified } = await import('../src/store.js');
    const { evaluatePreToolUse } = await import('../src/evaluate.js');
    const { fingerprintOf } = await import('../src/gate.js');

    const command = 'rm -rf /tmp/f2-flag';
    const fp = fingerprintOf(command);
    writeVerified({ sid: 'sid-ci', verifiedAt: Date.now() }, fp);

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'proceed-by-verification');
  });
});
