/**
 * A2 — gated entry: a shell command or an external `mcp__*` wire name reaches
 * POST /guard/evaluate, and a step-up challenge comes back as a deny JSON with
 * exit 0. Every pending challenge opens the browser, fresh or reused (t8 —
 * pins the `pending`-only branch of evaluate.ts; backend SET NX dedupes the
 * session mint, so all tabs share one auth URL).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runHook } from '../harness/hook-runner.js';
import { assertOnlyEvaluateTraffic, MockBackend, type VerdictPayload } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';
import { ALL_HOSTS, wire } from '../harness/wire.js';

function challenge(spec: { provider: string; url: string; exist: boolean }): VerdictPayload {
  return {
    decision: 'stepup',
    permission: 2,
    resource: 'system',
    action: 'update',
    reasoning: 'e2e challenge',
    summary: 'e2e summary',
    provider: spec.provider,
    consume_in_hook: true,
    sid: 'tc_stepup_e2e',
    url: spec.url,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    exist: spec.exist,
    status: 'pending',
  };
}

for (const host of ALL_HOSTS) {
  const spec = wire[host];

  describe(`A2 gated entry [${host}]`, () => {
    test('shell command reaches evaluate and denies with a fresh challenge', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();

      const mfaUrl = `${mock.url}/mfa`;
      mock.onEvaluate(challenge({ provider: spec.providerSlug, url: mfaUrl, exist: false }));

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin('rm -rf /tmp/e2e-target', world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertDeny(res);
      assert.equal(mock.evaluateRequests().length, 1);
      assert.deepEqual(await world.waitForBrowserLaunches(1), [mfaUrl]);
      assertOnlyEvaluateTraffic(mock);
    });

    test('external MCP wire name reaches evaluate and denies', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();

      const mfaUrl = `${mock.url}/mfa`;
      mock.onEvaluate(challenge({ provider: spec.providerSlug, url: mfaUrl, exist: false }));

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        // Name deliberately free of tc_/transcodes/version substrings.
        stdin: spec.mcpStdin('mcp__external_server__delete_thing', { id: 42 }, world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertDeny(res);
      assert.equal(mock.evaluateRequests().length, 1);
      assertOnlyEvaluateTraffic(mock);
    });

    test('reused coordinate (exist:true) denies and still launches the browser', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();

      const mfaUrl = `${mock.url}/mfa`;
      mock.onEvaluate(challenge({ provider: spec.providerSlug, url: mfaUrl, exist: true }));

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin('rm -rf /tmp/e2e-target', world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertDeny(res);
      assert.equal(mock.evaluateRequests().length, 1);
      assert.deepEqual(await world.waitForBrowserLaunches(1), [mfaUrl]);
      assertOnlyEvaluateTraffic(mock);
    });
  });
}
