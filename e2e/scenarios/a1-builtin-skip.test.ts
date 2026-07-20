/**
 * A1 — step-up meta tools and the host's builtin-exempt list skip the gate
 * entirely: silent pass (empty stdout), exit 0, ZERO backend requests, ZERO
 * state files.
 *
 * Token is PRESENT on purpose — a token-less run would pass these names for
 * the wrong reason path; with a token, only the skip predicate explains the
 * silence. The deadlock direction matters most: gating
 * `tc_poll_stepup_session_wait` would make deny-recovery circular.
 *
 * t9 narrowed the built-in skip from the full registered tc_* set to the
 * 4-name meta set — non-meta tc_* names are now gated (pinned in A2).
 *
 * t2 landed: the per-host builtin-exempt data files are iterated below, so
 * every list entry is pinned end-to-end (list → dist bundle → silent pass).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import antigravityExempt from '../../packages/core/src/patterns/data/builtin-exempt/antigravity.json' with { type: 'json' };
import claudeExempt from '../../packages/core/src/patterns/data/builtin-exempt/claude.json' with { type: 'json' };
import codexExempt from '../../packages/core/src/patterns/data/builtin-exempt/codex.json' with { type: 'json' };
import cursorExempt from '../../packages/core/src/patterns/data/builtin-exempt/cursor.json' with { type: 'json' };
import { GUARD_META_TOOL_NAMES } from '../../packages/core/src/patterns/guard-tool-names.generated.js';
import { type HostId, runHook } from '../harness/hook-runner.js';
import { MockBackend } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';
import { ALL_HOSTS, antigravityCallMcpStdin, wire } from '../harness/wire.js';

const BUILTIN_NAMES = [
  ...GUARD_META_TOOL_NAMES, // deny-recovery meta set — gating any of these = deadlock
  'mcp__plugin_mcp_plugin_transcodes_guard__tc_poll_stepup_session_wait',
];

// HostId is the plugin dir name; the JSON files are keyed by provider slug
// ('claude-code' plugin → 'claude' provider).
const EXEMPT_BY_HOST: Record<HostId, readonly { name: string }[]> = {
  'claude-code': claudeExempt,
  codex: codexExempt,
  cursor: cursorExempt,
  antigravity: antigravityExempt,
};

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

    for (const entry of EXEMPT_BY_HOST[host]) {
      test(`builtin-exempt ${entry.name} → silent pass, no backend traffic, no state`, async (t) => {
        const world = makeWorld();
        t.after(() => world.dispose());
        const mock = await MockBackend.start();
        t.after(() => mock.close());
        world.writeToken();

        const res = await runHook({
          host,
          hook: 'pre-tool-use',
          stdin: spec.mcpStdin(entry.name, {}, world.home),
          env: world.env(mock.url),
          cwd: world.home,
        });

        spec.assertPass(res);
        assert.equal(mock.requests.length, 0, 'exempt skip must not touch the backend');
        assert.deepEqual(world.stateFiles(), [], 'exempt skip must not write state');
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
