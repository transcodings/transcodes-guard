import assert from 'node:assert/strict';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  capturePrompt,
  resolvePromptContext,
} from '../src/hosts/prompt-cache.js';
import { promptCacheDir } from '../src/paths/index.js';

const root = mkdtempSync(path.join(tmpdir(), 'guard-prompt-cache-'));
const originalPluginData = process.env.PLUGIN_DATA;
const originalClaudePluginData = process.env.CLAUDE_PLUGIN_DATA;

function resetCache(): void {
  rmSync(path.join(root, 'prompt-cache'), { recursive: true, force: true });
}

function cacheFiles(): string[] {
  try {
    return readdirSync(promptCacheDir());
  } catch {
    return [];
  }
}

before(() => {
  process.env.PLUGIN_DATA = root;
  delete process.env.CLAUDE_PLUGIN_DATA;
});

after(() => {
  if (originalPluginData === undefined) delete process.env.PLUGIN_DATA;
  else process.env.PLUGIN_DATA = originalPluginData;
  if (originalClaudePluginData === undefined) {
    delete process.env.CLAUDE_PLUGIN_DATA;
  } else {
    process.env.CLAUDE_PLUGIN_DATA = originalClaudePluginData;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('prompt cache', () => {
  it('uses PLUGIN_DATA before the Claude compatibility variable', () => {
    process.env.CLAUDE_PLUGIN_DATA = path.join(root, 'compat');
    assert.equal(promptCacheDir(), path.join(root, 'prompt-cache'));
    delete process.env.PLUGIN_DATA;
    assert.equal(
      promptCacheDir(),
      path.join(root, 'compat', 'prompt-cache'),
    );
    process.env.PLUGIN_DATA = root;
  });

  it('selects an exact current turn and never stores the session id', () => {
    resetCache();
    capturePrompt({
      host: 'codex',
      sessionId: 'sensitive-session-id',
      promptId: 'turn-1',
      prompt: '첫 번째 작업',
      capturedAt: 1_000,
    });
    capturePrompt({
      host: 'codex',
      sessionId: 'sensitive-session-id',
      promptId: 'turn-2',
      prompt: '두 번째 작업',
      capturedAt: 2_000,
    });

    assert.deepEqual(
      resolvePromptContext({
        host: 'codex',
        sessionId: 'sensitive-session-id',
        promptId: 'turn-1',
        now: 2_001,
      }),
      { tasks: '첫 번째 작업', source: 'prompt_hook' },
    );
    const files = cacheFiles();
    assert.equal(files.length, 1);
    assert.match(files[0] ?? '', /^[a-f0-9]{64}\.json$/);
    assert.doesNotMatch(
      readFileSync(path.join(promptCacheDir(), files[0] ?? ''), 'utf8'),
      /sensitive-session-id/,
    );
    assert.doesNotMatch(
      readFileSync(path.join(promptCacheDir(), files[0] ?? ''), 'utf8'),
      /turn-1/,
    );
  });

  it('does not use an uncorrelated cached prompt when the tool event has no turn id', () => {
    assert.deepEqual(
      resolvePromptContext({
        host: 'codex',
        sessionId: 'sensitive-session-id',
        now: 2_001,
      }),
      { source: 'absent' },
    );
  });

  it('falls back to transcript on turn mismatch and cache expiry', () => {
    const transcript = path.join(root, 'transcript.jsonl');
    writeFileSync(
      transcript,
      `${JSON.stringify({ type: 'last-prompt', lastPrompt: 'transcript fallback' })}\n`,
    );
    assert.deepEqual(
      resolvePromptContext({
        host: 'codex',
        sessionId: 'sensitive-session-id',
        promptId: 'unknown-turn',
        transcriptPath: transcript,
        now: 2_001,
      }),
      { tasks: 'transcript fallback', source: 'transcript' },
    );
    assert.deepEqual(
      resolvePromptContext({
        host: 'codex',
        sessionId: 'sensitive-session-id',
        transcriptPath: transcript,
        now: 2_000 + 24 * 60 * 60 * 1_000 + 1,
      }),
      { tasks: 'transcript fallback', source: 'transcript' },
    );
  });

  it('retains four turns, bounds raw prompt bytes, and locks permissions', () => {
    resetCache();
    for (let i = 0; i < 6; i += 1) {
      capturePrompt({
        host: 'claude',
        sessionId: 'bounded',
        promptId: `p-${i}`,
        prompt: i === 5 ? '가'.repeat(20_000) : `prompt-${i}`,
      });
    }
    const file = path.join(promptCacheDir(), cacheFiles()[0] ?? '');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      entries: Array<{ prompt: string }>;
    };
    assert.equal(parsed.entries.length, 4);
    assert.ok(Buffer.byteLength(parsed.entries.at(-1)?.prompt ?? '') <= 32 * 1024);
    assert.equal(lstatSync(promptCacheDir()).mode & 0o777, 0o700);
    assert.equal(lstatSync(file).mode & 0o777, 0o600);
  });

  it('reads a cache containing four fully bounded JSON-escaped prompts', () => {
    resetCache();
    for (let i = 0; i < 4; i += 1) {
      capturePrompt({
        host: 'codex',
        sessionId: 'escaped',
        promptId: `turn-${i}`,
        prompt: '"'.repeat(32 * 1024),
        capturedAt: 10_000 + i,
      });
    }
    assert.deepEqual(
      resolvePromptContext({
        host: 'codex',
        sessionId: 'escaped',
        promptId: 'turn-3',
        now: 10_005,
      }),
      { tasks: '"'.repeat(299) + '…', source: 'prompt_hook' },
    );
  });

  it('matches an oversized opaque turn id without exhausting the file budget', () => {
    resetCache();
    const promptId = 'opaque-turn-id-'.repeat(1_024);
    for (let i = 0; i < 4; i += 1) {
      capturePrompt({
        host: 'codex',
        sessionId: 'long-id',
        promptId: `${promptId}${i}`,
        prompt: '"'.repeat(32 * 1024),
        capturedAt: 20_000 + i,
      });
    }
    assert.deepEqual(
      resolvePromptContext({
        host: 'codex',
        sessionId: 'long-id',
        promptId: `${promptId}3`,
        now: 20_005,
      }),
      { tasks: '"'.repeat(299) + '…', source: 'prompt_hook' },
    );
  });

  it('preserves the transcript session title for a cached current prompt', () => {
    resetCache();
    capturePrompt({
      host: 'codex',
      sessionId: 'titled-session',
      promptId: 'titled-turn',
      prompt: 'cached current prompt',
      capturedAt: 10_005,
    });
    const transcript = path.join(root, 'title.jsonl');
    writeFileSync(
      transcript,
      `${JSON.stringify({ type: 'ai-title', aiTitle: 'release audit' })}\n`,
    );
    assert.deepEqual(
      resolvePromptContext({
        host: 'codex',
        sessionId: 'titled-session',
        promptId: 'titled-turn',
        transcriptPath: transcript,
        now: 10_005,
      }),
      {
        tasks: 'release audit · cached current prompt',
        source: 'prompt_hook',
      },
    );
  });

  it('bounds the global cache to 256 sessions and leaves no temp files', () => {
    resetCache();
    for (let i = 0; i < 257; i += 1) {
      capturePrompt({
        host: 'cursor',
        sessionId: `session-${i}`,
        prompt: `prompt-${i}`,
        capturedAt: 10_000 + i,
      });
    }

    const files = cacheFiles();
    assert.equal(files.length, 256);
    assert.ok(files.every((file) => /^[a-f0-9]{64}\.json$/.test(file)));
  });

  it('fails soft when the cache root is a symlink', () => {
    resetCache();
    const target = path.join(root, 'symlink-target');
    mkdirSync(target);
    symlinkSync(target, path.join(root, 'prompt-cache'));
    capturePrompt({
      host: 'cursor',
      sessionId: 'session',
      prompt: 'must not be written through the link',
    });
    assert.deepEqual(readdirSync(target), []);
    assert.deepEqual(
      resolvePromptContext({ host: 'cursor', sessionId: 'session' }),
      { source: 'absent' },
    );
  });
});
