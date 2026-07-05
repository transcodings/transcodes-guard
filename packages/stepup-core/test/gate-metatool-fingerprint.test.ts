/**
 * Pins the CURRENT gate scope for host meta tools: the per-host bypass
 * (`isHostMetaTool`) was disabled in 48aff45 — its call site in
 * `classifyToolCall` is commented out pending rework (per-host dispatch +
 * Antigravity regex replacement), so every non-transcodes tool name reaches
 * /guard/evaluate and blocks without a token. When the bypass is re-enabled,
 * flip the "gated while bypass is disabled" cases below back to
 * proceed-ungated.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

let home: string;
const origHome = process.env.HOME;
const origHost = process.env.TRANSCODES_GUARD_HOST;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'guard-metatool-'));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = origHome;
  process.env.TRANSCODES_GUARD_HOST = origHost;
  rmSync(home, { recursive: true, force: true });
});

function sessionEnvelope(): Record<string, unknown> {
  return {
    session_id: '310712fc-5d02-4a49-9abf-42ba0a460730',
    transcript_path:
      '/Users/gsong/.claude/projects/-Users-gsong-Projects/310712fc.jsonl',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
  };
}

describe('host meta tool bypass', () => {
  it('Claude ToolSearch is gated while bypass is disabled', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'claude';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'ToolSearch',
      toolInput: { query: 'select:Read' },
      rawPayload: {
        ...sessionEnvelope(),
        tool_name: 'ToolSearch',
        tool_input: { query: 'select:Read' },
      },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Claude Bash is gated', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'claude';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Cursor Read is gated while bypass is disabled', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'cursor';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'Read',
      toolInput: { path: '/tmp/foo.ts' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Cursor todo_write is gated while bypass is disabled', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'cursor';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'todo_write',
      toolInput: { todos: [] },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Shell is still gated', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'cursor';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'Shell',
      toolInput: { command: 'echo hi' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Codex update_plan is gated while bypass is disabled', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'codex';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'update_plan',
      toolInput: { plan: 'step 1' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Codex Bash is gated', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'codex';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Codex mcp__ wire names are not bypassed', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'codex';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'mcp__mongodb__list_collections',
      toolInput: {},
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Codex apply_patch is gated', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'codex';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'apply_patch',
      toolInput: { patch: '--- a\n+++ b' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Codex parallel is gated', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'codex';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'parallel',
      toolInput: { calls: [] },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Antigravity files.read is gated while bypass is disabled', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'antigravity';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'files.read',
      toolInput: { path: '/tmp/foo.ts' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Antigravity code_search is gated while bypass is disabled', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'antigravity';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'code_search',
      toolInput: { query: 'foo' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Antigravity run_command is gated', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'antigravity';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'run_command',
      toolInput: { command: 'echo hi' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Antigravity terminal.run is gated', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'antigravity';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'terminal.run',
      toolInput: { command: 'echo hi' },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });

  it('Antigravity mcp__ wire names are not bypassed', async () => {
    process.env.TRANSCODES_GUARD_HOST = 'antigravity';
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'mcp__mongodb__list_collections',
      toolInput: {},
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'block-no-token');
  });
});
