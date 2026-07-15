/**
 * B1–B6 — the Guard v3 state model, end to end against the committed bundles.
 *
 * The through-line of every case below is the same invariant: `~/.transcodes/`
 * has no state directory to speak of, at any point, at any permission level.
 * t3 removed the local verified/pending record, so the ONLY thing that decides
 * a gated call is the backend's answer to `POST /guard/evaluate`.
 *
 * Why an e2e for this and not a unit test: `evaluate-decision-matrix.test.ts`
 * already asserts the empty-state invariant, but it calls `evaluatePreToolUse`
 * in-process. These cases run the real committed bundle in a real child process
 * with a real temp HOME — the layer where a stray `writeFileSync` in a hook
 * entry (not in `evaluate.ts`) would actually show up.
 *
 * Note on B1: an already-verified coordinate reaches the client as
 * `permission: 1`, NOT as "permission 2 + verified". The backend's
 * `sessionRedirectResult` rewrites a reused VERIFIED session to
 * `decision:'allow'` + `permission: 1` (and drops sid/url) before it goes on
 * the wire, so the client sees three outcomes, not four. The fixtures encode
 * that: there is deliberately no `{permission:2, status:'verified'}` case,
 * because the backend cannot emit one.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { runHook } from '../harness/hook-runner.js';
import { assertOnlyEvaluateTraffic, MockBackend, type VerdictPayload } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';
import { ALL_HOSTS, wire } from '../harness/wire.js';

const GATED_COMMAND = 'rm -rf /tmp/e2e-target';

/** permission 1 — allow without step-up (also how a reused VERIFIED arrives). */
function allowVerdict(provider: string): VerdictPayload {
  return {
    decision: 'allow',
    permission: 1,
    resource: 'system',
    action: 'update',
    reasoning: 'e2e: coordinate already verified',
    provider,
    exist: true,
    status: 'verified',
  };
}

/** permission 2 + sid/url — a step-up challenge. */
function challengeVerdict(provider: string, url: string, exist = false): VerdictPayload {
  return {
    decision: 'stepup',
    permission: 2,
    resource: 'system',
    action: 'update',
    reasoning: 'e2e challenge',
    provider,
    sid: 'tc_stepup_e2e',
    url,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    exist,
    status: 'pending',
  };
}

for (const host of ALL_HOSTS) {
  const spec = wire[host];

  describe(`B1 verified hit → 1-RTT allow [${host}]`, () => {
    test('permission 1 passes in one round trip and writes no state', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();

      mock.onEvaluate(allowVerdict(spec.providerSlug));

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin(GATED_COMMAND, world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertPass(res);
      assert.equal(mock.evaluateRequests().length, 1, 'exactly one round trip');
      assert.deepEqual(world.stateFiles(), [], 'a verified hit must not be cached locally');
      assert.deepEqual(await world.waitForBrowserLaunches(1, 500), []);
      assertOnlyEvaluateTraffic(mock);
    });
  });

  describe(`B2 step-up round trip [${host}]`, () => {
    test('challenge → deny(url), then retry after verify → allow, no state written', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();

      const mfaUrl = `${mock.url}/mfa`;
      // Call 1: not yet verified → challenge. Call 2 (the agent's retry, after
      // the user authenticated in the browser): the coordinate is now verified,
      // which the backend delivers as a plain permission-1 allow.
      mock.onEvaluate(challengeVerdict(spec.providerSlug, mfaUrl));
      mock.onEvaluate(allowVerdict(spec.providerSlug));

      const denied = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin(GATED_COMMAND, world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      const deny = spec.assertDeny(denied);
      assert.ok(deny.reason.includes(mfaUrl), 'the deny must carry the auth URL');
      assert.deepEqual(await world.waitForBrowserLaunches(1), [mfaUrl]);
      // THE point of B2: the challenge leg persists nothing. Pre-v3 this is
      // where a pending record hit the disk.
      assert.deepEqual(world.stateFiles(), [], 'challenge must write no pending record');

      const retried = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin(GATED_COMMAND, world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertPass(retried);
      assert.equal(mock.evaluateRequests().length, 2, 'retry re-asks the backend');
      assert.deepEqual(world.stateFiles(), [], 'the allow leg must write no verified record');
      assertOnlyEvaluateTraffic(mock);
    });
  });

  describe(`B3 session create failed [${host}]`, () => {
    test('permission 2 without sid/url → create-failed deny, exit 0', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();

      // permission 2 but the session never materialized (sid/url absent) —
      // issue #189's shape. Must deny, and the deny must be diagnosable.
      mock.onEvaluate({
        decision: 'stepup',
        permission: 2,
        resource: 'system',
        action: 'update',
        provider: spec.providerSlug,
        sid: null,
        url: null,
        status: null,
      });

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin(GATED_COMMAND, world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertDeny(res);
      assert.deepEqual(world.stateFiles(), []);
      assert.deepEqual(await world.waitForBrowserLaunches(1, 500), [], 'no url → no browser');
      assertOnlyEvaluateTraffic(mock);
    });
  });

  describe(`B4 backend down → gated calls all denied [${host}]`, () => {
    test('unreachable backend denies (the accepted availability trade)', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      // Start a mock only to borrow a loopback port, then close it so the
      // port is dead — the misfire guard requires a loopback URL either way.
      const mock = await MockBackend.start();
      const deadUrl = mock.url;
      await mock.close();
      world.writeToken();

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin(GATED_COMMAND, world.home),
        env: world.env(deadUrl),
        cwd: world.home,
      });

      // No local record to fall back on — by design. The old "5xx → trust the
      // local record" fallback died with the record it trusted.
      spec.assertDeny(res);
      assert.deepEqual(world.stateFiles(), []);
    });

    test('HTTP 500 denies rather than falling open', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();

      mock.enqueueEvaluate({ kind: 'http-error', status: 500 });

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin(GATED_COMMAND, world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertDeny(res);
      assert.deepEqual(world.stateFiles(), []);
      assertOnlyEvaluateTraffic(mock);
    });
  });

  describe(`B6 stale legacy state is ignored [${host}]`, () => {
    test('a pre-v3 verified record on disk does not grant a pass', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();

      // Forge the exact artifact the pre-v3 fast path would have trusted.
      // A v3 client has no reader for it, so the backend's verdict must win.
      const stateDir = join(world.home, '.transcodes', 'state');
      mkdirSync(stateDir, { recursive: true });
      const legacy = join(stateDir, 'stepup-verified.deadbeefdeadbeef.json');
      writeFileSync(
        legacy,
        JSON.stringify({
          sid: 'tc_stepup_forged',
          status: 'verified',
          fp: 'deadbeefdeadbeef',
          resource: 'system',
          action: 'update',
          verifiedAt: Date.now(),
        }),
      );

      mock.onEvaluate(challengeVerdict(spec.providerSlug, `${mock.url}/mfa`));

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin(GATED_COMMAND, world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      // The forged record must buy nothing: the hook still asks, still denies.
      spec.assertDeny(res);
      assert.equal(mock.evaluateRequests().length, 1, 'a local record must not short-circuit the ask');
      // And the hook must not have "consumed" (deleted) it either — v3 simply
      // does not touch this directory.
      assert.deepEqual(
        world.stateFiles(),
        ['stepup-verified.deadbeefdeadbeef.json'],
        'v3 neither reads nor reaps legacy state — it is inert, not managed',
      );
      assertOnlyEvaluateTraffic(mock);
    });
  });
}

/**
 * B5 — cross-machine. Two independent HOMEs (= two machines) share one backend.
 * Machine A authenticates; machine B runs the same command and passes in one
 * round trip without ever seeing A's disk. This is only possible because
 * `verified` lives on the backend coordinate, not in a local file — pre-v3 the
 * record was per-HOME and B would have had to re-authenticate.
 *
 * Host-agnostic: the property is about state ownership, not wire format, so it
 * runs once on claude-code rather than 4x.
 */
describe('B5 cross-machine: verified follows the coordinate, not the disk', () => {
  const spec = wire['claude-code'];

  test('machine B passes on A′s verification with no shared disk', async (t) => {
    const machineA = makeWorld();
    const machineB = makeWorld();
    t.after(() => {
      machineA.dispose();
      machineB.dispose();
    });
    const mock = await MockBackend.start();
    t.after(() => mock.close());

    // Same member/project on both machines — same coordinate.
    const claims = { pid: 'proj-shared', mid: 'member-shared' };
    machineA.writeToken(claims);
    machineB.writeToken(claims);

    const mfaUrl = `${mock.url}/mfa`;
    mock.onEvaluate(challengeVerdict(spec.providerSlug, mfaUrl));
    mock.onEvaluate(allowVerdict(spec.providerSlug));

    const aDenied = await runHook({
      host: 'claude-code',
      hook: 'pre-tool-use',
      stdin: spec.shellStdin(GATED_COMMAND, machineA.home),
      env: machineA.env(mock.url),
      cwd: machineA.home,
    });
    spec.assertDeny(aDenied);

    // Machine B: different HOME, never touched A's filesystem.
    const bRes = await runHook({
      host: 'claude-code',
      hook: 'pre-tool-use',
      stdin: spec.shellStdin(GATED_COMMAND, machineB.home),
      env: machineB.env(mock.url),
      cwd: machineB.home,
    });

    spec.assertPass(bRes);
    assert.deepEqual(machineA.stateFiles(), [], 'A holds nothing');
    assert.deepEqual(machineB.stateFiles(), [], 'B holds nothing');
    assertOnlyEvaluateTraffic(mock);
  });
});
