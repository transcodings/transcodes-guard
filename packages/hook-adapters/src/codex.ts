/**
 * OpenAI Codex CLI hook adapter.
 *
 * Codex's hook wire format converged on Claude Code's. Per
 * developers.openai.com/codex/hooks (GA as of v0.132, May 2026):
 *  - PreToolUse uses `hookSpecificOutput.permissionDecision` with
 *    `"allow" | "deny" | "ask"` plus `permissionDecisionReason` and an
 *    optional `updatedInput` to rewrite arguments before execution.
 *  - Stop uses top-level `{ decision: "block", reason }`.
 *  - SessionStart / UserPromptSubmit use `hookSpecificOutput.additionalContext`.
 *  - stdin fields use snake_case: `tool_name`, `tool_input`, `tool_use_id`.
 *
 * Codex still accepts a few legacy shapes (`approve` for allow,
 * `{ continue: false, stopReason }` for deny), but we always emit the
 * modern form — older Codex versions don't have hooks GA anyway, so
 * compatibility downgrades are unnecessary.
 */
import { claudeCodeAdapter } from './claude-code.js';
import type {
  HookAdapter,
  PreToolUseDecision,
  PreToolUseInput,
  UserPromptSubmitInput,
} from './types.js';

export const codexAdapter: HookAdapter = {
  host: 'codex',

  // Stdin field names match Claude Code's snake_case schema verbatim, so
  // the parse logic is identical. Delegating preserves a single source of
  // truth for stdin shape parsing.
  parsePreToolUseStdin(raw: string): PreToolUseInput {
    return claudeCodeAdapter.parsePreToolUseStdin(raw);
  },

  parseUserPromptSubmitStdin(raw: string): UserPromptSubmitInput {
    return claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
  },

  emitPreToolUse(decision: PreToolUseDecision): string {
    return claudeCodeAdapter.emitPreToolUse(decision);
  },

  emitSessionStartContext(additionalContext: string): string {
    return claudeCodeAdapter.emitSessionStartContext(additionalContext);
  },

  emitUserPromptSubmitContext(additionalContext: string): string {
    return claudeCodeAdapter.emitUserPromptSubmitContext(additionalContext);
  },

  emitStop(reason: string): string {
    return claudeCodeAdapter.emitStop(reason);
  },
};
