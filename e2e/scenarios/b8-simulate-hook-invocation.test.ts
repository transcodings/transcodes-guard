/**
 * B8 — `tc_simulate_hook_invocation` reports the hook's decision structurally.
 *
 * This tool is the agent's oracle for "what did the hook actually do?", and
 * until now it answered by grepping the deny PROSE for `tc_stepup_`
 * (t3 §6 follow-up ④). Two ways that lies: reword the human-facing deny copy
 * and the detection silently goes false; emit any other deny that happens to
 * quote a sid and it goes falsely true. It now parses the structured stderr tag
 * (`formatStderrTag`), which is machine-readable by construction.
 *
 * Testing it needs the MCP server, not just the hook — hence `mcp-runner.ts`,
 * and hence the PRD pairing these two items in the same phase: this regression
 * had no observation surface before now.
 *
 * The tool spawns the hook via CLAUDE_PLUGIN_ROOT, so the plugin root is passed
 * through the world env — the child hook inherits the same temp HOME and mock
 * backend as the server.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { McpRunner, pluginRootFor } from '../harness/mcp-runner.js';
import { assertOnlyEvaluateTraffic, MockBackend } from '../harness/mock-backend.js';
import { makeWorld } from '../harness/state.js';

const PLUGIN_ROOT = pluginRootFor('claude-code');

type SimulateResult = {
  deny_emitted: boolean;
  new_step_up_started: boolean;
  step_up_sid?: string;
  exit_code: number;
  stdout_json?: unknown;
  stderr?: string;
};

async function simulate(
  mock: MockBackend,
  world: ReturnType<typeof makeWorld>,
  command: string,
): Promise<SimulateResult> {
  const env = { ...world.env(mock.url), CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const runner = await McpRunner.start('claude-code', env);
  try {
    const res = await runner.callTool('tc_simulate_hook_invocation', {
      command,
      cwd: world.home,
    });
    if (res.isError) {
      throw new Error(
        `tc_simulate_hook_invocation rejected: ${JSON.stringify(res.content)}`,
      );
    }
    return res.json<SimulateResult>();
  } finally {
    await runner.close();
  }
}

describe('B8 simulate_hook_invocation reports step-up structurally', () => {
  test('a real challenge sets new_step_up_started and surfaces the sid', async (t) => {
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
      provider: 'claude',
      sid: 'tc_stepup_b8_minted',
      url: `${mock.url}/mfa`,
      exist: false,
      status: 'pending',
    });

    const out = await simulate(mock, world, 'rm -rf /tmp/e2e-b8');

    assert.equal(out.deny_emitted, true);
    assert.equal(out.new_step_up_started, true);
    assert.equal(out.step_up_sid, 'tc_stepup_b8_minted');
    assert.equal(out.exit_code, 0, 'a deny still exits 0');
    assert.deepEqual(world.stateFiles(), []);
  });

  test('a policy deny (permission 0) does NOT count as a new step-up', async (t) => {
    const world = makeWorld();
    t.after(() => world.dispose());
    const mock = await MockBackend.start();
    t.after(() => mock.close());
    world.writeToken();

    mock.onEvaluate({
      decision: 'deny',
      permission: 0,
      resource: 'system',
      action: 'update',
      reasoning: 'e2e: role has no access',
      provider: 'claude',
    });

    const out = await simulate(mock, world, 'rm -rf /tmp/e2e-b8');

    assert.equal(out.deny_emitted, true);
    assert.equal(out.new_step_up_started, false, 'permission 0 mints no session');
    assert.equal(out.step_up_sid, undefined);
    assertOnlyEvaluateTraffic(mock);
  });

  test('a pass reports no deny and no step-up', async (t) => {
    const world = makeWorld();
    t.after(() => world.dispose());
    const mock = await MockBackend.start();
    t.after(() => mock.close());
    world.writeToken();

    mock.onEvaluate({
      decision: 'allow',
      permission: 1,
      resource: 'system',
      action: 'update',
      provider: 'claude',
    });

    const out = await simulate(mock, world, 'echo safe');

    assert.equal(out.deny_emitted, false);
    assert.equal(out.new_step_up_started, false);
    assert.deepEqual(world.stateFiles(), []);
  });

  test('create-failed quotes no sid it did not mint', async (t) => {
    const world = makeWorld();
    t.after(() => world.dispose());
    const mock = await MockBackend.start();
    t.after(() => mock.close());
    world.writeToken();

    // permission 2 with no session — the deny text is about a FAILED create.
    // The old prose-grep would have been at the mercy of whatever that copy
    // says; the tag says `stepup-create-failed`, which is not a challenge.
    mock.onEvaluate({
      decision: 'stepup',
      permission: 2,
      resource: 'system',
      action: 'update',
      provider: 'claude',
      sid: null,
      url: null,
      status: null,
    });

    const out = await simulate(mock, world, 'rm -rf /tmp/e2e-b8');

    assert.equal(out.deny_emitted, true);
    assert.equal(out.new_step_up_started, false, 'a failed create started no step-up');
    assert.equal(out.step_up_sid, undefined);
  });
});
