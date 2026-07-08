/**
 * Unit tests for the Codex hook adapter's PreToolUse divergence from Claude
 * Code (WS3 / C1). Codex's parser rejects a bare `allow` (no `updatedInput`)
 * as an unsupported permissionDecision, which fails the hook OPEN. The adapter
 * downgrades a bare allow to no-output (a safe pass on Codex) instead of
 * delegating to the Claude Code shape, which would emit a Codex-invalid payload.
 *
 * Verified against openai/codex `main` (output_parser.rs, 2026-05-28, v0.143):
 * `permissionDecision:"allow"` is valid only with `updatedInput`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { claudeCodeAdapter } from '../src/hosts/claude-code.js';
import { codexAdapter } from '../src/hosts/codex.js';

describe('codexAdapter.emitPreToolUse — C1 bare-allow divergence', () => {
  it('emits no output for a bare allow (Codex rejects it → fail-open)', () => {
    const out = codexAdapter.emitPreToolUse({ kind: 'allow', reason: '' });
    assert.equal(out, '');
  });

  it('emits no output for a bare allow even with a reason string', () => {
    const out = codexAdapter.emitPreToolUse({
      kind: 'allow',
      reason: 'verified',
    });
    assert.equal(out, '');
  });

  it('delegates an allow WITH updatedInput (valid Codex rewrite)', () => {
    const decision = {
      kind: 'allow' as const,
      reason: 'rewrite',
      updatedInput: { command: 'ls' },
    };
    assert.equal(
      codexAdapter.emitPreToolUse(decision),
      claudeCodeAdapter.emitPreToolUse(decision),
    );
  });

  it('delegates deny verbatim (Codex deny shape matches Claude Code)', () => {
    const decision = {
      kind: 'deny' as const,
      reason: 'blocked',
      systemMessage: 'long form',
    };
    assert.equal(
      codexAdapter.emitPreToolUse(decision),
      claudeCodeAdapter.emitPreToolUse(decision),
    );
  });
});
