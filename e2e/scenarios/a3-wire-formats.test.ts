/**
 * A3 — per-host wire formats, deep-checked through wire.ts (the single mirror
 * of mcp-and-hosts): every deny kind is a JSON body + exit 0 (never exit 2),
 * cursor stays flat, antigravity stays top-level `decision`, and the shared
 * claude/codex deny always carries a non-empty reason (Codex's parser rejects
 * an empty one → fail-open). permission 1 is the only Phase A "allow"
 * observable: a silent pass on claude-code/codex/antigravity, an explicit
 * flat `{"permission":"allow"}` on cursor (failClosed:true — no output would
 * read as hook failure).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runHook } from '../harness/hook-runner.js';
import { assertOnlyEvaluateTraffic, MockBackend, type VerdictPayload } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';
import { ALL_HOSTS, wire } from '../harness/wire.js';

function verdict(overrides: Partial<VerdictPayload>): VerdictPayload {
  return { permission: 2, resource: 'system', action: 'update', ...overrides };
}

for (const host of ALL_HOSTS) {
  const spec = wire[host];

  describe(`A3 wire formats [${host}]`, () => {
    test('permission 0 (policy deny) → host deny shape', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();
      mock.onEvaluate(verdict({ decision: 'deny', permission: 0, reasoning: 'matrix denies' }));

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin('rm -rf /tmp/e2e-target', world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertDeny(res);
      assertOnlyEvaluateTraffic(mock);
    });

    test('permission 2 challenge → host deny shape', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();
      mock.onEvaluate(
        verdict({
          decision: 'stepup',
          sid: 'tc_stepup_e2e',
          url: `${mock.url}/mfa`,
          exist: true, // reuse → no browser side effect in this shape test
          status: 'pending',
        }),
      );

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin('rm -rf /tmp/e2e-target', world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertDeny(res);
    });

    test('no token → deny in host shape without touching the backend', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      // no writeToken()

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin('rm -rf /tmp/e2e-target', world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertDeny(res);
      assert.equal(mock.requests.length, 0, 'no-token deny must be decided locally');
    });

    test('permission 1 (allow by policy) → per-host pass shape', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();
      mock.onEvaluate(verdict({ decision: 'allow', permission: 1 }));

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin('echo safe', world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertPass(res);
      assert.equal(mock.evaluateRequests().length, 1);
    });
  });
}
