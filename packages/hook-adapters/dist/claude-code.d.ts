/**
 * Claude Code hook adapter.
 *
 * Wire format mirrors what the existing plugins/claude-code
 * hooks already emit (PreToolUse `hookSpecificOutput.permissionDecision`,
 * Stop top-level `decision: "block"`). See `.claude/rules/hooks.md` for the
 * per-event payload contract Claude Code's validator enforces.
 *
 * Host identification (TRANSCODES_GUARD_HOST env var) is claimed by each
 * plugin's `host.ts` side-effect file, NOT here — the hook-adapters barrel
 * re-exports all four adapters, so setting env in the adapter would cause
 * whichever loads last to overwrite the previous claim.
 */
import type { HookAdapter } from './types.js';
export declare const claudeCodeAdapter: HookAdapter;
