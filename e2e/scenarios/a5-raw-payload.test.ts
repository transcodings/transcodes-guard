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
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

    // Each host names the turn identifier differently; all four normalize onto
    // `prompt_id`. Model: Claude Code alone reports none (it sends `effort`).
    const turnIdKey = { 'claude-code': 'prompt_id', codex: 'turn_id', cursor: 'generation_id', antigravity: 'stepIdx' }[host];
    const modelKey = host === 'antigravity' ? 'modelName' : 'model';

    test('host identifiers ride as first-class fields, absent ones are omitted', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();
      mock.onEvaluate(ALLOW);

      const stdinObj = JSON.parse(spec.shellStdin('echo e2e', world.home)) as Record<string, unknown>;
      // Antigravity sends no per-invocation id at all; the other three do.
      if (host !== 'antigravity') stdinObj.tool_use_id = 'e2e-tool-use';
      // Antigravity's `stepIdx` is a number the adapter stringifies; the rest are opaque strings.
      stdinObj[turnIdKey] = host === 'antigravity' ? 7 : 'e2e-turn';
      stdinObj[modelKey] = 'e2e-model';

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
      const body = req.body as Record<string, unknown>;

      // Antigravity names the session `conversationId`; the adapter normalizes it.
      const expectedSession =
        host === 'antigravity' ? stdinObj.conversationId : stdinObj.session_id;
      assert.equal(body.session_id, expectedSession, 'session_id must reach the wire');
      assert.equal(body.prompt_id, host === 'antigravity' ? '7' : 'e2e-turn', `${turnIdKey} must normalize onto prompt_id`);
      assert.equal(body.agent_model, 'e2e-model');

      if (host === 'antigravity') {
        // Absent, not null — the backend stores missing signals as absent so
        // `{$exists: false}` keeps meaning "the host never sent this".
        assert.ok(!('tool_use_id' in body), 'an absent id must be omitted, never nulled');
      } else {
        assert.equal(body.tool_use_id, 'e2e-tool-use');
      }
      // The transcript path is read locally to build `tasks`; it must never ship.
      assert.ok(!('transcript_path' in body), 'the transcript path must never reach the backend');
      assertOnlyEvaluateTraffic(mock);
    });

    test('tasks is built from the transcript and the transcript itself stays home', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();
      mock.onEvaluate(ALLOW);

      const transcriptPath = join(world.home, 'e2e-transcript.jsonl');
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({ type: 'ai-title', aiTitle: 'auditing the gate' })}\n` +
          `${JSON.stringify({ type: 'last-prompt', lastPrompt: 'list the deny paths' })}\n`,
      );

      const stdinObj = JSON.parse(spec.shellStdin('echo e2e', world.home)) as Record<string, unknown>;
      stdinObj[host === 'antigravity' ? 'transcriptPath' : 'transcript_path'] = transcriptPath;

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
      const body = req.body as Record<string, unknown>;
      assert.equal(body.tasks, 'auditing the gate · list the deny paths');
      // The summary is what i1 adds; the path is not promoted to a field of its
      // own. It does still reach the backend inside the verbatim `payload`, as
      // it has since before this ticket — every prod document carries one.
      assert.ok(!('transcript_path' in body), 'the path is not promoted to a first-class field');
      // What must never travel is the transcript's contents.
      assert.ok(
        !JSON.stringify(body).includes('list the deny paths\n'),
        'only the derived summary ships, never transcript lines',
      );
    });

    test('an unreadable transcript drops tasks and leaves the gate untouched', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();
      mock.onEvaluate(ALLOW);

      const stdinObj = JSON.parse(spec.shellStdin('echo e2e', world.home)) as Record<string, unknown>;
      stdinObj[host === 'antigravity' ? 'transcriptPath' : 'transcript_path'] = join(world.home, 'does-not-exist.jsonl');

      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: JSON.stringify(stdinObj),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertPass(res); // the verdict is unchanged — tasks is not load-bearing
      const [req] = mock.evaluateRequests();
      assert.ok(req, 'evaluate request must have been sent');
      assert.ok(!('tasks' in (req.body as object)), 'an unbuildable summary must be omitted, never nulled');
    });

    test('a host that reports no model omits agent_model rather than nulling it', async (t) => {
      const world = makeWorld();
      t.after(() => world.dispose());
      const mock = await MockBackend.start();
      t.after(() => mock.close());
      world.writeToken();
      mock.onEvaluate(ALLOW);

      // Real Claude Code stdin carries `effort`, never `model` — the shape the
      // 154 genuinely-Claude-Code documents in prod have.
      const res = await runHook({
        host,
        hook: 'pre-tool-use',
        stdin: spec.shellStdin('echo e2e', world.home),
        env: world.env(mock.url),
        cwd: world.home,
      });

      spec.assertPass(res);
      const [req] = mock.evaluateRequests();
      assert.ok(req, 'evaluate request must have been sent');
      assert.ok(!('agent_model' in (req.body as object)), 'a missing model must be omitted, never nulled');
    });

    if (host === 'claude-code') {
      // Measured on prod: 1,225 of the 1,379 `provider=claude` documents carry
      // Cursor-shaped stdin (`cursor_version` / `generation_id` / `user_email`)
      // against 154 genuinely Claude Code ones — the claude-code plugin
      // installed inside Cursor. The cursor adapter never runs for that
      // traffic, so this parser must recognize Cursor's field names itself.
      test('Cursor-shaped stdin reaching the claude-code plugin still normalizes', async (t) => {
        const world = makeWorld();
        t.after(() => world.dispose());
        const mock = await MockBackend.start();
        t.after(() => mock.close());
        world.writeToken();
        mock.onEvaluate(ALLOW);

        const stdinObj = {
          tool_name: 'Bash',
          tool_input: { command: 'echo e2e' },
          cwd: world.home,
          session_id: 'e2e-session',
          conversation_id: 'e2e-conversation',
          generation_id: 'e2e-generation',
          tool_use_id: 'e2e-tool-use',
          model: 'e2e-cursor-model',
          cursor_version: '1.0.0',
          workspace_roots: [world.home],
          user_email: 'e2e@example.com',
          transcript_path: `${world.home}/agent-transcripts/e2e.jsonl`,
          hook_event_name: 'PreToolUse',
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
        const body = req.body as Record<string, unknown>;
        assert.equal(body.prompt_id, 'e2e-generation', "Cursor's generation_id must normalize onto prompt_id");
        assert.equal(body.agent_model, 'e2e-cursor-model');
        assert.equal(body.session_id, 'e2e-session');
        assert.equal(body.tool_use_id, 'e2e-tool-use');
      });
    }

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
