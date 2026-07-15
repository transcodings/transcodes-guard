/**
 * builtin-exempt per-host lists — predicate behavior + data invariants
 * (toolgate t2 §2-b·§2-c·§3). The lists are an allowlist compiled into the
 * bundle: an exec-capable name entering one is a gate bypass, so the
 * invariants here are security assertions, not style checks.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  builtinExemptEntries,
  GUARD_PROVIDERS,
  isBuiltinExemptToolName,
} from '../src/patterns/tool-rules.js';

describe('isBuiltinExemptToolName', () => {
  it('exempts listed names on their own host only', () => {
    assert.equal(isBuiltinExemptToolName('claude', 'TodoWrite'), true);
    assert.equal(isBuiltinExemptToolName('cursor', 'Read'), true);
    assert.equal(isBuiltinExemptToolName('codex', 'update_plan'), true);
    assert.equal(isBuiltinExemptToolName('antigravity', 'view_file'), true);
    // claude-only name must not leak to cursor
    assert.equal(isBuiltinExemptToolName('cursor', 'ExitPlanMode'), false);
  });

  it('unknown host → no exemption (fail-safe)', () => {
    assert.equal(isBuiltinExemptToolName(undefined, 'TodoWrite'), false);
  });

  it('exact match only — no case folding, no prefix', () => {
    assert.equal(isBuiltinExemptToolName('claude', 'todowrite'), false);
    assert.equal(isBuiltinExemptToolName('claude', 'TodoWriteExtra'), false);
    assert.equal(isBuiltinExemptToolName('cursor', 'read'), false);
  });

  it('grade ③/④ names dropped from the dead regexes stay gated', () => {
    assert.equal(isBuiltinExemptToolName('cursor', 'Write'), false);
    assert.equal(isBuiltinExemptToolName('cursor', 'Delete'), false);
    assert.equal(isBuiltinExemptToolName('cursor', 'StrReplace'), false);
    assert.equal(isBuiltinExemptToolName('cursor', 'WebFetch'), false);
    assert.equal(isBuiltinExemptToolName('cursor', 'WebSearch'), false);
    assert.equal(isBuiltinExemptToolName('codex', 'run'), false);
    assert.equal(isBuiltinExemptToolName('codex', 'imagegen'), false);
  });
});

// ── list invariants (PRD §3) ────────────────────────────────────────────

const GATED_DENYLIST = new Set([
  'bash',
  'shell',
  'exec_command',
  'apply_patch',
  'parallel',
  'write_stdin',
  'run_command',
  'call_mcp_tool',
]);
const TERMINAL_PREFIX = /^terminal/i;
// Mirrors detectShellCommand in tool-rules.ts (module-private there).
const SHELL_METACHAR_OR_SPACE = /[\s|&;<>$*()`\\/]/;

for (const provider of GUARD_PROVIDERS) {
  describe(`builtin-exempt invariants [${provider}]`, () => {
    const entries = builtinExemptEntries(provider);

    it('web has no exemptions at all', { skip: provider !== 'web' }, () => {
      assert.equal(entries.length, 0);
    });

    it('no mcp__ prefixed names', () => {
      for (const e of entries) {
        assert.ok(!/^mcp__/i.test(e.name), e.name);
      }
    });

    it('no shell metacharacters or whitespace in names', () => {
      for (const e of entries) {
        assert.ok(!SHELL_METACHAR_OR_SPACE.test(e.name), e.name);
      }
    });

    it('every entry carries a non-empty reason', () => {
      for (const e of entries) {
        assert.ok(e.reason.trim().length > 0, e.name);
      }
    });

    it('no duplicate names', () => {
      const names = entries.map((e) => e.name);
      assert.equal(new Set(names).size, names.length);
    });

    it('gated-denylist union (exec/write wire names) is absent', () => {
      for (const e of entries) {
        assert.ok(!GATED_DENYLIST.has(e.name.toLowerCase()), e.name);
        assert.ok(!TERMINAL_PREFIX.test(e.name), e.name);
      }
    });
  });
}
