/**
 * Regression: host-internal meta tools (ToolSearch, ...) must bypass the gate —
 * the backend classifier has no mapping for them; gating them would force
 * step-up and wedge the Stop-reminder loop.
 *
 * (Guard v3 removed per-command fingerprint / pending files — grouping is
 * backend SSOT keyed on session sid + resource + action.)
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

let home: string;
const origHome = process.env.HOME;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'guard-metatool-'));
  process.env.HOME = home;
  process.env.TRANSCODES_GUARD_HOST = 'claude';
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

/** Session-constant hook-payload fields — typical Claude Code PreToolUse shape. */
function sessionEnvelope(): Record<string, unknown> {
  return {
    session_id: '310712fc-5d02-4a49-9abf-42ba0a460730',
    transcript_path:
      '/Users/gsong/.claude/projects/-Users-gsong-Projects/310712fc-5d02-4a49-9abf-42ba0a460730.jsonl',
    cwd: '/Users/gsong/Projects/some/deeply/nested/workspace/directory',
    hook_event_name: 'PreToolUse',
    permission_mode: 'default',
  };
}

describe('host-internal meta tools bypass the gate', () => {
  it('ToolSearch proceeds ungated without token or backend', async () => {
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

    assert.equal(decision.kind, 'proceed-ungated');
  });
});
