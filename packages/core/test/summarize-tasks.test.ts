/**
 * Unit tests for the transcript summarizer that builds the `tasks` field (i1).
 *
 * Record shapes come from real transcripts, not from a spec — no host ever
 * documented its transcript format for us. Claude Code and Codex were read off
 * local files; the Antigravity shape is the one this repo already duck-typed
 * for the retired user-"done" bridge. Cursor remains unmeasured, which is what
 * the generic fallback exists for.
 *
 * The governing rule is that failure degrades to no summary. A transcript is
 * worth strictly less than the gate it rides on, so nothing here may throw.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { summarizeTasks } from '../src/hosts/transcript.js';

const dir = mkdtempSync(join(tmpdir(), 'guard-tasks-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let seq = 0;
/** Write records as JSONL and return the path. */
function transcript(...records: unknown[]): string {
  const path = join(dir, `t${seq++}.jsonl`);
  writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return path;
}

describe('summarizeTasks — per-host record shapes', () => {
  it('joins Claude Code ai-title and last-prompt, title first', () => {
    const path = transcript(
      { type: 'ai-title', aiTitle: 'PRD 문서 정리', sessionId: 's' },
      { type: 'last-prompt', lastPrompt: '리서치 리포트를 다듬어줘', sessionId: 's' },
    );
    assert.equal(summarizeTasks(path), 'PRD 문서 정리 · 리서치 리포트를 다듬어줘');
  });

  it('keeps the latest of each when a session rewrites them', () => {
    const path = transcript(
      { type: 'ai-title', aiTitle: 'old title' },
      { type: 'last-prompt', lastPrompt: 'old prompt' },
      { type: 'ai-title', aiTitle: 'new title' },
      { type: 'last-prompt', lastPrompt: 'new prompt' },
    );
    assert.equal(summarizeTasks(path), 'new title · new prompt');
  });

  it('reads the Codex user_message event envelope', () => {
    const path = transcript(
      { type: 'session_meta', payload: { id: 'x', cwd: '/home/me' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'run the migration' } },
      { type: 'turn_context', payload: { model: 'gpt-5.1-codex-mini' } },
    );
    assert.equal(summarizeTasks(path), 'run the migration');
  });

  it('duck-types a role-tagged record for hosts with no known schema', () => {
    const path = transcript(
      { role: 'user', content: 'deploy to staging' },
      { role: 'assistant', content: 'on it' },
    );
    assert.equal(summarizeTasks(path), 'deploy to staging');
  });

  it('reads a Claude Code subagent transcript, which carries no title records', () => {
    const path = transcript(
      { type: 'user', message: { role: 'user', content: 'GREEN phase for CONFIG-06b' } },
      { type: 'assistant', message: { role: 'assistant', content: 'starting' } },
    );
    assert.equal(summarizeTasks(path), 'GREEN phase for CONFIG-06b');
  });
});

describe('summarizeTasks — tool results must not be mistaken for instructions', () => {
  it('skips tool_result blocks and keeps the human text block', () => {
    const path = transcript({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '48 files changed' },
          { type: 'text', text: 'now write the changelog' },
        ],
      },
    });
    assert.equal(summarizeTasks(path), 'now write the changelog');
  });

  it('summarizes nothing when a user record is only a tool result', () => {
    const path = transcript({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
      },
    });
    assert.equal(summarizeTasks(path), undefined);
  });
});

describe('summarizeTasks — degradation', () => {
  it('returns undefined without a path', () => {
    assert.equal(summarizeTasks(undefined), undefined);
  });

  it('returns undefined for a file that does not exist', () => {
    assert.equal(summarizeTasks(join(dir, 'absent.jsonl')), undefined);
  });

  it('returns undefined for an unrecognized record schema', () => {
    const path = transcript({ kind: 'something', body: 'unfamiliar' });
    assert.equal(summarizeTasks(path), undefined);
  });

  it('survives malformed JSONL and still reads the intact lines', () => {
    const path = join(dir, 'malformed.jsonl');
    writeFileSync(path, `{not json\n${JSON.stringify({ type: 'ai-title', aiTitle: 'survivor' })}\n`);
    assert.equal(summarizeTasks(path), 'survivor');
  });

  it('degrades to whichever half survives', () => {
    const path = transcript({ type: 'ai-title', aiTitle: 'title only' });
    assert.equal(summarizeTasks(path), 'title only');
  });
});

describe('summarizeTasks — the summary stays one short line', () => {
  it('flattens newlines so the value stays a single line', () => {
    const path = transcript({ type: 'last-prompt', lastPrompt: 'first line\n\nsecond   line' });
    assert.equal(summarizeTasks(path), 'first line second line');
  });

  it('ellipsizes each half rather than shipping a whole prompt', () => {
    const path = transcript(
      { type: 'ai-title', aiTitle: 'a'.repeat(500) },
      { type: 'last-prompt', lastPrompt: 'b'.repeat(500) },
    );
    const out = summarizeTasks(path) ?? '';
    for (const half of out.split(' · ')) {
      assert.equal(half.length, 300, 'each half is clipped to 300 characters');
      assert.ok(half.endsWith('…'), 'a clipped half is marked as truncated');
    }
  });

  it('reads only the tail of a transcript far larger than the 32KB window', () => {
    const path = join(dir, 'huge.jsonl');
    const filler = `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'x'.repeat(2000) } })}\n`;
    writeFileSync(
      path,
      filler.repeat(60) +
        `${JSON.stringify({ type: 'ai-title', aiTitle: 'recent work' })}\n`,
    );
    assert.equal(summarizeTasks(path), 'recent work');
  });
});
