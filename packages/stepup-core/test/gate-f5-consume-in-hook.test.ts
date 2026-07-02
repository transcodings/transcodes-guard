/**
 * Unit tests for F5 — the backend's `consume_in_hook` verdict drives
 * `decision.consumeHere` instead of the old hardcoded `true`.
 *
 * The value only exists at challenge time (in the `/guard/evaluate` verdict),
 * so it travels challenge → pending record → fast-path claim:
 *   1. challenge: `evaluatePreToolUse` copies `verdict.consume_in_hook` into
 *      the pending record it hands the caller.
 *   2. fast path: the paired pending record's `consumeInHook` becomes
 *      `decision.consumeHere`; absent (legacy record) → true.
 *
 * Same temp-HOME pattern as gate-f2-no-token.test.ts (state files resolve
 * under `~/.transcodes/state`, os.homedir() honours $HOME on Linux). The
 * challenge test additionally needs a token (fake JWT in
 * `~/.transcodes/config.json`), a mock `/v1/guard/evaluate` server via
 * TRANSCODES_BACKEND_URL, and a pre-claimed browser lock so the gate never
 * spawns a real browser from the test run.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

let home: string;
const origHome = process.env.HOME;
const origBackendUrl = process.env.TRANSCODES_BACKEND_URL;
const origFlag = process.env.TRANSCODES_GUARD_TEST_TRUST;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'guard-f5-'));
  process.env.HOME = home;
  process.env.TRANSCODES_GUARD_HOST = 'claude';
  delete process.env.TRANSCODES_BACKEND_URL;
  delete process.env.TRANSCODES_GUARD_TEST_TRUST;
});

afterEach(() => {
  process.env.HOME = origHome;
  if (origBackendUrl === undefined) delete process.env.TRANSCODES_BACKEND_URL;
  else process.env.TRANSCODES_BACKEND_URL = origBackendUrl;
  if (origFlag === undefined) delete process.env.TRANSCODES_GUARD_TEST_TRUST;
  else process.env.TRANSCODES_GUARD_TEST_TRUST = origFlag;
  rmSync(home, { recursive: true, force: true });
});

/** Minimal member token that satisfies parseMemberAccessToken. */
function fakeJwt(): string {
  const payload = Buffer.from(
    JSON.stringify({
      oid: 'org-f5',
      pid: 'proj-f5',
      mid: 'member-f5',
      aud: 'transcodes-mcp',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  return `h.${payload}.s`;
}

function writeTokenConfig(): void {
  const dir = path.join(home, '.transcodes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ token: fakeJwt() }));
}

describe('F5 — consume_in_hook wiring', () => {
  it('challenge stores the backend verdict in the pending record', async () => {
    const { evaluatePreToolUse } = await import('../src/evaluate.js');
    const { fingerprintOf } = await import('../src/gate.js');
    const { cacheDir } = await import('@transcodes-guard/plugin-paths');

    const command = 'rm -rf /tmp/f5-challenge';
    writeTokenConfig();

    // Pre-claim the browser lock for this command so launchStepupBrowser
    // skips the real spawn (claimBrowserLaunch sees a fresh same-fp claim).
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(
      path.join(cacheDir(), 'stepup-browser-lock.json'),
      JSON.stringify({ fingerprint: fingerprintOf(command), openedAt: Date.now() }),
    );

    const server: Server = createServer((req, res) => {
      assert.equal(req.url, '/v1/guard/evaluate');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          logId: 'x',
          success: true,
          statusCode: 200,
          payload: [
            {
              permission: 2,
              resource: 'command',
              action: 'update',
              reasoning: 'test verdict',
              consume_in_hook: false,
              sid: 'sid-f5',
              url: 'http://127.0.0.1:9/never-opened',
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
          error: null,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    process.env.TRANSCODES_BACKEND_URL = `http://127.0.0.1:${address.port}`;

    try {
      const decision = await evaluatePreToolUse({
        toolName: 'Bash',
        toolInput: { command },
        cwd: '/tmp',
      });

      assert.equal(decision.kind, 'block-stepup-challenged');
      assert.ok('pending' in decision);
      assert.equal(decision.pending.consumeInHook, false);
      assert.equal(decision.pending.fp, fingerprintOf(command));
    } finally {
      server.close();
    }
  });

  it('fast path forwards consumeInHook=false from the paired pending', async () => {
    process.env.TRANSCODES_GUARD_TEST_TRUST = '1'; // skip the backend recheck
    const { writeVerified } = await import('../src/store.js');
    const { writePending } = await import('../src/pending.js');
    const { evaluatePreToolUse } = await import('../src/evaluate.js');
    const { fingerprintOf } = await import('../src/gate.js');

    const command = 'rm -rf /tmp/f5-false';
    const fp = fingerprintOf(command);
    writeVerified({ sid: 'sid-f5-false', verifiedAt: Date.now() }, fp);
    writePending({
      sid: 'sid-f5-false',
      command,
      reason: 'test',
      browserUrl: 'http://127.0.0.1:9/x',
      createdAt: Date.now(),
      status: 'pending',
      fp,
      consumeInHook: false,
    });

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'proceed-by-verification');
    assert.ok('consumeHere' in decision);
    assert.equal(decision.consumeHere, false);
  });

  it('fast path defaults to consumeHere=true when the field is absent', async () => {
    process.env.TRANSCODES_GUARD_TEST_TRUST = '1';
    const { writeVerified } = await import('../src/store.js');
    const { writePending } = await import('../src/pending.js');
    const { evaluatePreToolUse } = await import('../src/evaluate.js');
    const { fingerprintOf } = await import('../src/gate.js');

    const command = 'rm -rf /tmp/f5-legacy';
    const fp = fingerprintOf(command);
    writeVerified({ sid: 'sid-f5-legacy', verifiedAt: Date.now() }, fp);
    // Legacy pending record — predates the consumeInHook field.
    writePending({
      sid: 'sid-f5-legacy',
      command,
      reason: 'test',
      browserUrl: 'http://127.0.0.1:9/x',
      createdAt: Date.now(),
      status: 'pending',
      fp,
    });

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'proceed-by-verification');
    assert.ok('consumeHere' in decision);
    assert.equal(decision.consumeHere, true);
  });
});
