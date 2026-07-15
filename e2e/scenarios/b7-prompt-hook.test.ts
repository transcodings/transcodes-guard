/**
 * B7 — prompt-hook harmlessness (PR #204 review follow-up).
 *
 * t3 rewrote every prompt hook into an inert shell, but e2e coverage was zero:
 * A6 covers Stop only, and `wire.ts` had no prompt spec at all. That gap is
 * load-bearing in a specific way — the four hosts LOOK inconsistent (three exit
 * silently, cursor emits `{continue:true}`), so the natural "cleanup" is to
 * delete cursor's emit and make them uniform. That refactor is wrong: cursor's
 * beforeSubmitPrompt contract requires a verdict on stdout, and prompt hooks
 * fail open, so the breakage would be silent at runtime too.
 *
 * This suite pins the divergence itself. Antigravity is absent on purpose — it
 * has no prompt hook (PreInvocation is a SessionStart stand-in, a different
 * contract), so `promptHook()` returns null and the host is skipped.
 *
 * Inputs are the three stdin shapes a host can realistically deliver:
 * well-formed, empty (closed pipe), and garbage. All three must behave
 * identically — the hook has nothing to read stdin for.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { promptHook, runHook } from '../harness/hook-runner.js';
import { assertOnlyEvaluateTraffic, MockBackend } from '../harness/mock-backend.js';
import { makeWorld, type TestWorld } from '../harness/state.js';
import { ALL_HOSTS, wire } from '../harness/wire.js';

const STDIN_SHAPES = ['well-formed', 'empty', 'garbage'] as const;

for (const host of ALL_HOSTS) {
  const spec = wire[host];
  const hook = promptHook(host);

  // Antigravity: no prompt hook to test.
  if (hook === null || spec.assertPromptInert === null) continue;

  const assertInert = spec.assertPromptInert;

  describe(`B7 prompt hook is inert [${host}]`, () => {
    let world: TestWorld;
    let mock: MockBackend;

    before(async () => {
      world = makeWorld();
      mock = await MockBackend.start();
      world.writeToken();
    });

    after(async () => {
      // The prompt hook must never call the backend at all — not even evaluate.
      assert.deepEqual(
        mock.requests.map((r) => `${r.method} ${r.path}`),
        [],
        'prompt hook must send no backend traffic whatsoever',
      );
      assertOnlyEvaluateTraffic(mock);
      await mock.close();
      world.dispose();
    });

    for (const shape of STDIN_SHAPES) {
      it(`${shape} stdin → inert, no state, no traffic`, async () => {
        const stdin =
          shape === 'well-formed'
            ? (spec.promptStdin('인증 완료했어', world.home) ?? '')
            : shape === 'empty'
              ? ''
              : 'not json at all }{';

        const res = await runHook({
          host,
          hook,
          stdin,
          env: world.env(mock.url),
          cwd: world.home,
        });

        // Host-specific contract: silence (claude/codex) vs {continue:true}
        // (cursor). The divergence is asserted, not smoothed over.
        assertInert(res);

        assert.deepEqual(
          world.stateFiles(),
          [],
          'prompt hook must write no client state (t3)',
        );
        assert.deepEqual(world.browserLaunches(), [], 'prompt hook must open no browser');
      });
    }
  });
}
