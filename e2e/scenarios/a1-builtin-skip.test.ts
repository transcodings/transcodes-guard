/**
 * A1 — built-in transcodes-guard MCP names skip the gate entirely: silent
 * pass (empty stdout), exit 0, ZERO backend requests, ZERO state files.
 *
 * Token is PRESENT on purpose — a token-less run would pass these names for
 * the wrong reason path; with a token, only the skip predicate explains the
 * silence. The deadlock direction matters most: gating
 * `tc_poll_stepup_session_wait` would make deny-recovery circular.
 *
 * After t2 lands (built-in list as per-host data files), extend the fixture
 * list by iterating those data files.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runHook } from '../harness/hook-runner.js';
import { MockBackend } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';
import { ALL_HOSTS, antigravityCallMcpStdin, wire } from '../harness/wire.js';

const BUILTIN_NAMES = [
  'tc_poll_stepup_session_wait', // deny-recovery poll tool — gating it = deadlock
  'tc_retire_member',
  'mcp__plugin_mcp_plugin_transcodes_guard__tc_poll_stepup_session_wait',
];

for (const host of ALL_HOSTS) {
  const spec = wire[host];

  describe(`A1 built-in skip [${host}]`, () => {
    for (const name of BUILTIN_NAMES) {
      test(`${name} → silent pass, no backend traffic, no state`, async (t) => {
        const world = makeWorld();
        t.after(() => world.dispose());
        const mock = await MockBackend.start();
        t.after(() => mock.close());
        world.writeToken(); // token present: silence must come from the skip, not no-token

        const res = await runHook({
          host,
          hook: 'pre-tool-use',
          stdin: spec.mcpStdin(name, {}, world.home),
          env: world.env(mock.url),
          cwd: world.home,
        });

        spec.assertPass(res);
        assert.equal(mock.requests.length, 0, 'skip must not touch the backend');
        assert.deepEqual(world.stateFiles(), [], 'skip must not write state');
      });
    }

    if (host === 'antigravity') {
      test('call_mcp_tool wrapper unwraps ToolName before the skip check', async (t) => {
        const world = makeWorld();
        t.after(() => world.dispose());
        const mock = await MockBackend.start();
        t.after(() => mock.close());
        world.writeToken();

        const res = await runHook({
          host,
          hook: 'pre-tool-use',
          stdin: antigravityCallMcpStdin('tc_poll_stepup_session_wait', {}, world.home),
          env: world.env(mock.url),
          cwd: world.home,
        });

        spec.assertPass(res);
        assert.equal(mock.requests.length, 0);
      });
    }
  });
}
