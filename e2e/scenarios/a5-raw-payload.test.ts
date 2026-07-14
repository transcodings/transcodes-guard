/**
 * A5 — raw-payload contract: the evaluate POST body carries the hook's stdin
 * JSON VERBATIM as `payload` (sentinel field included), plus the wire
 * `tool_name`, the host `provider` slug, and the token in
 * `x-transcodes-token`. If t1 changes the evaluate schema, update here.
 *
 * Antigravity's `call_mcp_tool` wrapper is pinned separately: `tool_name`
 * must be the UNWRAPPED inner ToolName while `payload` stays the wrapper
 * object as received.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runHook } from '../harness/hook-runner.js';
import { assertOnlyEvaluateTraffic, MockBackend, type VerdictPayload } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';
import { ALL_HOSTS, wire } from '../harness/wire.js';

const ALLOW: VerdictPayload = {
  decision: 'allow',
  permission: 1,
  resource: 'system',
  action: 'update',
};

for (const host of ALL_HOSTS) {
  const spec = wire[host];

  describe(`A5 raw payload [${host}]`, () => {
    test('evaluate body carries stdin verbatim + tool_name + provider + token header', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      const token = world.writeToken();
      mock.onEvaluate(ALLOW);

      // Sentinel field the adapters don't know about — proves verbatim pass-through.
      const stdinObj = JSON.parse(spec.shellStdin('echo e2e', world.home)) as Record<string, unknown>;
      stdinObj.extra_marker = 'E2E_SENTINEL';
      const stdin = JSON.stringify(stdinObj);

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin,
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertPass(res); // permission 1 → per-host pass shape (wire.ts)
      const [req] = mock.evaluateRequests();
      assert.ok(req, 'evaluate request must have been sent');
      const body = req.body as { payload: unknown; tool_name?: string; provider?: string };
      assert.deepEqual(body.payload, stdinObj, 'payload must be the stdin JSON verbatim');
      assert.equal(body.tool_name, spec.shellToolName);
      assert.equal(body.provider, spec.providerSlug);
      assert.equal(req.headers['x-transcodes-token'], token);
      assertOnlyEvaluateTraffic(mock);
    });

    if (host === 'antigravity') {
      test('call_mcp_tool: tool_name unwrapped, payload stays the wrapper', async (t) => {
        const world = makeWorld();
        t.after(() => world.dispose());
        const mock = await MockBackend.start();
        t.after(() => mock.close());
        world.writeToken();
        mock.onEvaluate(ALLOW);

        const stdinObj = {
          toolCall: {
            name: 'call_mcp_tool',
            args: { ToolName: 'mcp__external_server__delete_thing', ToolArgs: { id: 7 } },
          },
          stepIdx: 1,
          conversationId: 'e2e-conversation',
          workspacePaths: [world.home],
        };

        const res = await runHook({
          host,
          hook: 'pre-tool-use',
          stdin: JSON.stringify(stdinObj),
          env: world.env(mock.url),
          cwd: world.home,
        });

        spec.assertPass(res);
        const [req] = mock.evaluateRequests();
        assert.ok(req, 'evaluate request must have been sent');
        const body = req.body as { payload: unknown; tool_name?: string };
        assert.equal(body.tool_name, 'mcp__external_server__delete_thing');
        assert.deepEqual(body.payload, stdinObj, 'payload must be the wrapper as received');
      });
    }
  });
}
