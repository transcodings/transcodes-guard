/** B7 — host prompt capture remains fail-soft and preserves host stdout. */
import assert from 'node:assert/strict';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promptHook, runHook } from '../harness/hook-runner.js';
import { MockBackend } from '../harness/mock-backend.js';
import { makeWorld, type TestWorld } from '../harness/state.js';
import { ALL_HOSTS, wire } from '../harness/wire.js';

function promptCacheFiles(home: string): string[] {
  try {
    return readdirSync(join(home, '.transcodes', 'cache', 'prompts'));
  } catch {
    return [];
  }
}

for (const host of ALL_HOSTS) {
  const spec = wire[host];
  const hook = promptHook(host);
  if (hook === null || spec.assertPromptInert === null) continue;

  describe(`B7 prompt capture [${host}]`, () => {
    let world: TestWorld;
    let mock: MockBackend;

    before(async () => {
      world = makeWorld();
      mock = await MockBackend.start();
      world.writeToken();
    });

    after(async () => {
      assert.deepEqual(mock.requests, [], 'prompt hook must send no backend traffic');
      await mock.close();
      world.dispose();
    });

    it('captures well-formed stdin and preserves the host continuation contract', async () => {
      const res = await runHook({
        host,
        hook,
        stdin: spec.promptStdin('현재 턴의 사용자 요청', world.home) ?? '',
        env: world.env(mock.url),
        cwd: world.home,
      });
      spec.assertPromptInert?.(res);
      const files = promptCacheFiles(world.home);
      assert.equal(files.length, 1);
      const raw = readFileSync(
        join(world.home, '.transcodes', 'cache', 'prompts', files[0] ?? ''),
        'utf8',
      );
      assert.match(raw, /현재 턴의 사용자 요청/);
      assert.doesNotMatch(raw, /e2e-session/);
      assert.deepEqual(world.stateFiles(), []);
      assert.deepEqual(world.browserLaunches(), []);
    });

    for (const [label, stdin] of [
      ['empty', ''],
      ['garbage', 'not json at all }{'],
    ] as const) {
      it(`${label} stdin is harmless`, async () => {
        const beforeFiles = promptCacheFiles(world.home);
        const res = await runHook({
          host,
          hook,
          stdin,
          env: world.env(mock.url),
          cwd: world.home,
        });
        spec.assertPromptInert?.(res);
        assert.deepEqual(promptCacheFiles(world.home), beforeFiles);
      });
    }
  });
}

describe('B7 prompt capture [antigravity]', () => {
  let world: TestWorld;
  let mock: MockBackend;

  before(async () => {
    world = makeWorld();
    mock = await MockBackend.start();
    world.writeToken();
  });

  after(async () => {
    assert.deepEqual(mock.requests, []);
    await mock.close();
    world.dispose();
  });

  it('recovers the latest transcript prompt on invocation zero', async () => {
    const transcript = join(world.home, 'transcript.jsonl');
    writeFileSync(
      transcript,
      `${JSON.stringify({ role: 'user', content: 'Antigravity 현재 요청' })}\n`,
    );
    const res = await runHook({
      host: 'antigravity',
      hook: 'pre-invocation',
      stdin: JSON.stringify({
        invocationNum: 0,
        initialNumSteps: 0,
        conversationId: 'e2e-conversation',
        transcriptPath: transcript,
        workspacePaths: [world.home],
      }),
      env: world.env(mock.url),
      cwd: world.home,
    });
    assert.equal(res.exitCode, 0);
    const out = res.json() as { injectSteps?: unknown[] };
    assert.ok(Array.isArray(out.injectSteps), 'invocation zero injects the primer');
    const files = promptCacheFiles(world.home);
    assert.equal(files.length, 1);
    assert.match(
      readFileSync(
        join(world.home, '.transcodes', 'cache', 'prompts', files[0] ?? ''),
        'utf8',
      ),
      /Antigravity 현재 요청/,
    );
  });

  it('does not inject the primer again on invocation one', async () => {
    const transcript = join(world.home, 'transcript.jsonl');
    const res = await runHook({
      host: 'antigravity',
      hook: 'pre-invocation',
      stdin: JSON.stringify({
        invocationNum: 1,
        initialNumSteps: 1,
        conversationId: 'e2e-conversation',
        transcriptPath: transcript,
        workspacePaths: [world.home],
      }),
      env: world.env(mock.url),
      cwd: world.home,
    });
    assert.equal(res.stdout, '{}');
    const files = promptCacheFiles(world.home);
    assert.equal(files.length, 1);
    const cache = JSON.parse(
      readFileSync(
        join(world.home, '.transcodes', 'cache', 'prompts', files[0] ?? ''),
        'utf8',
      ),
    ) as { entries: unknown[] };
    assert.equal(cache.entries.length, 1, 'the same transcript turn is idempotent');
  });
});
