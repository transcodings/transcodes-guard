/**
 * C1 — registration identity: the data-driven registration loop (t5) exposes
 * exactly the generated GUARD_TOOL_NAMES set over a real `tools/list`, so a
 * definition/generated-constant drift (or a loop regression) is caught at
 * the same surface a host sees. The meta 4 are asserted explicitly: they are
 * the recovery plane the backend mirrors in `guard.meta-tools.ts`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GUARD_TOOL_NAMES } from '../../packages/core/src/patterns/guard-tool-names.generated.js';
import { McpRunner } from '../harness/mcp-runner.js';
import { MockBackend } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';

const META_TOOLS = [
  'tc_create_stepup_session',
  'tc_inspect_stepup_state',
  'tc_poll_stepup_session',
  'tc_poll_stepup_session_wait',
];

describe('C1 registration identity', () => {
  test('tools/list equals GUARD_TOOL_NAMES exactly (52 tools)', async (t) => {
    const world = makeWorld();
    t.after(() => world.dispose());
    const mock = await MockBackend.start();
    t.after(() => mock.close());
    world.writeToken();

    const runner = await McpRunner.start('claude-code', world.env(mock.url));
    try {
      const names = await runner.listToolNames();
      assert.equal(names.length, 52);
      assert.deepEqual([...names].sort(), [...GUARD_TOOL_NAMES].sort());
      for (const meta of META_TOOLS) {
        assert.ok(names.includes(meta), meta);
      }
    } finally {
      await runner.close();
    }
  });
});
