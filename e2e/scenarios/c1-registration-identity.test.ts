/**
 * C1 — registration identity: the data-driven registration loop (t5) exposes
 * exactly the generated GUARD_TOOL_NAMES set over a real `tools/list`, so a
 * definition/generated-constant drift (or a loop regression) is caught at
 * the same surface a host sees. The meta 4 are asserted explicitly: they are
 * the recovery plane the backend mirrors in `guard.meta-tools.ts`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  GUARD_META_TOOL_NAMES,
  GUARD_TOOL_NAMES,
} from '../../packages/core/src/patterns/guard-tool-names.generated.js';
import { McpRunner } from '../harness/mcp-runner.js';
import { MockBackend } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';

describe('C1 registration identity', () => {
  test('tools/list equals GUARD_TOOL_NAMES exactly', async (t) => {
    const world = makeWorld();
    t.after(() => world.dispose());
    const mock = await MockBackend.start();
    t.after(() => mock.close());
    world.writeToken();

    const runner = await McpRunner.start('claude-code', world.env(mock.url));
    try {
      const names = await runner.listToolNames();
      assert.deepEqual(
        [...names].sort(),
        [...GUARD_TOOL_NAMES].sort(),
        'tools/list differs from the generated GUARD_TOOL_NAMES. The runner spawns the committed plugin dist — after changing definitions, run `npm run build:plugin` before this suite.',
      );
      for (const meta of GUARD_META_TOOL_NAMES) {
        assert.ok(names.includes(meta), meta);
      }
    } finally {
      await runner.close();
    }
  });
});
