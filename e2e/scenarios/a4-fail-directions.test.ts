/**
 * A4 — fail directions of the asymmetric policy, as the committed bundles
 * actually behave (Guard v3):
 *
 *  - Backend unreachable (closed loopback port) → fail-CLOSED:
 *    create-failed deny, exit 0, one-line stderr tag. Never a crash, never a
 *    silent pass.
 *  - No token → fail-open before evaluate, including garbage stdin normalized
 *    to `toolName:'Unknown'`. The hook is inactive until the user signs in.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runHook } from '../harness/hook-runner.js';
import { MockBackend } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';
import { ALL_HOSTS, wire } from '../harness/wire.js';

// Closed port: TCP RST comes back immediately; still loopback so the misfire
// guard admits it. (Same address CI's inline smokes use.)
const CLOSED_PORT_URL = 'http://127.0.0.1:9';

const GARBAGE_STDINS = ['not json at all', '', '{"toolCall":'];

for (const host of ALL_HOSTS) {
  const spec = wire[host];

  describe(`A4 fail directions [${host}]`, () => {
    test('backend unreachable → fail-closed create-failed deny + stderr tag', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      world.writeToken();

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin('rm -rf /tmp/e2e-target', world.home),
        env: world.env(CLOSED_PORT_URL),
        cwd: world.home,
      });

      spec.assertDeny(res);
      assert.ok(res.stderr.length > 0, 'deny must leave a one-line human tag on stderr');
      assert.equal(res.timedOut, false);
    });

    for (const [i, garbage] of GARBAGE_STDINS.entries()) {
      test(`garbage stdin #${i} → no-token pass, no crash`, async (t) => {
        const world = makeWorld();
        t.after(() => world.dispose());
        const mock = await MockBackend.start();
        t.after(() => mock.close());
        // no token: the hook is intentionally inactive

        const res = await runHook({
          host,
          hook: 'pre-tool-use',
          stdin: garbage,
          env: world.env(mock.url),
          cwd: world.home,
        });

        spec.assertPass(res);
        assert.equal(res.exitCode, 0);
        assert.equal(mock.requests.length, 0);
      });
    }
  });
}
