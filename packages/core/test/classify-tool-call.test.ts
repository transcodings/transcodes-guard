/**
 * classifyToolCall acceptance matrix (toolgate t2 §3) — the built-in binary
 * decision as a pure function of (input, provider). `null` means skip
 * (PROCEED_UNGATED, no backend call); a Classified object means the call
 * goes to POST /guard/evaluate.
 *
 * Supersedes gate-metatool-fingerprint.test.ts, which pinned the interim
 * "bypass disabled" state that t2 replaced with the data-driven exemption.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GuardProvider } from '../src/patterns/tool-rules.js';
import {
  builtinExemptEntries,
  GUARD_TOOL_NAMES,
} from '../src/patterns/tool-rules.js';
import { classifyToolCall, type ToolCallInput } from '../src/stepup/evaluate.js';

const HOOK_PROVIDERS: readonly GuardProvider[] = [
  'claude',
  'codex',
  'cursor',
  'antigravity',
];

function input(toolName: string): ToolCallInput {
  return { toolName, toolInput: {}, cwd: '/tmp/e2e' };
}

describe('classifyToolCall — skip side', () => {
  it('registered tc_* names skip on every provider and on unknown provider', () => {
    for (const provider of [...HOOK_PROVIDERS, undefined]) {
      for (const name of GUARD_TOOL_NAMES) {
        assert.equal(classifyToolCall(input(name), provider), null, `${provider}:${name}`);
      }
    }
  });

  it('each builtin-exempt entry skips on its own provider', () => {
    for (const provider of HOOK_PROVIDERS) {
      for (const entry of builtinExemptEntries(provider)) {
        assert.equal(
          classifyToolCall(input(entry.name), provider),
          null,
          `${provider}:${entry.name}`,
        );
      }
    }
  });
});

describe('classifyToolCall — gated side (fail-safe)', () => {
  it('false-positive trio of the old substring predicate is gated', () => {
    for (const name of ['get_utc_time', 'btc_transfer', 'publish_version']) {
      for (const provider of HOOK_PROVIDERS) {
        assert.notEqual(classifyToolCall(input(name), provider), null, `${provider}:${name}`);
      }
    }
  });

  it('builtin-exempt names are gated on unknown provider', () => {
    for (const provider of HOOK_PROVIDERS) {
      for (const entry of builtinExemptEntries(provider)) {
        assert.notEqual(
          classifyToolCall(input(entry.name), undefined),
          null,
          entry.name,
        );
      }
    }
  });

  it('a provider\'s exempt names do not leak to other providers', () => {
    // ExitPlanMode is claude-only; run is nobody's.
    assert.notEqual(classifyToolCall(input('ExitPlanMode'), 'cursor'), null);
    assert.notEqual(classifyToolCall(input('run'), 'codex'), null);
  });

  it('shell wire names are always gated', () => {
    assert.notEqual(classifyToolCall(input('Bash'), 'claude'), null);
    assert.notEqual(classifyToolCall(input('Bash'), 'codex'), null);
    assert.notEqual(classifyToolCall(input('Shell'), 'cursor'), null);
    assert.notEqual(classifyToolCall(input('run_command'), 'antigravity'), null);
    assert.notEqual(classifyToolCall(input('call_mcp_tool'), 'antigravity'), null);
  });

  it('external mcp__* names are gated', () => {
    for (const provider of HOOK_PROVIDERS) {
      assert.notEqual(
        classifyToolCall(input('mcp__external_server__delete_thing'), provider),
        null,
      );
    }
  });
});
