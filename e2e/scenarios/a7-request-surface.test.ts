/**
 * A7 (rescoped) — request-surface minimization: one gated PreToolUse run
 * sends EXACTLY one outbound request, `POST /v1/guard/evaluate`. No
 * decision-audit, no telemetry, no poll from the hook process.
 *
 * Rescope note (2026-07-15): the original PRD row said "no POST body contains
 * the raw command string" — that described the retired client-side
 * decision-audit (removed in 5ee30baf; auditing is server-owned now) and
 * contradicts A5, which asserts the evaluate `payload` IS the verbatim stdin,
 * command included. What survives v3 is the surface guarantee below. The PRD
 * update rides the same PR.
 *
 * Every other scenario also calls `assertOnlyEvaluateTraffic` in its flow;
 * this file is the named home of the contract.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runHook } from '../harness/hook-runner.js';
import { assertOnlyEvaluateTraffic, MockBackend } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';
import { ALL_HOSTS, wire } from '../harness/wire.js';

for (const host of ALL_HOSTS) {
  const spec = wire[host];

  describe(`A7 request surface [${host}]`, () => {
    test('a full challenged round sends exactly one request: POST /v1/guard/evaluate', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();
      mock.onEvaluate({
        decision: 'stepup',
        permission: 2,
        resource: 'system',
        action: 'update',
        sid: 'tc_stepup_e2e',
        url: `${mock.url}/mfa`,
        exist: false,
        status: 'pending',
      });

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin('rm -rf /tmp/e2e-target', world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertDeny(res);
      // Let any stray fire-and-forget request land before counting.
      await world.waitForBrowserLaunches(1);
      assert.equal(mock.requests.length, 1, 'hook path must send exactly one request');
      assert.equal(mock.evaluateRequests().length, 1);
      assertOnlyEvaluateTraffic(mock);
    });
  });
}
