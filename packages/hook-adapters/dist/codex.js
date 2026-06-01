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
export const codexAdapter = {
    host: 'codex',
    // Stdin field names match Claude Code's snake_case schema verbatim, so
    // the parse logic is identical. Delegating preserves a single source of
    // truth for stdin shape parsing.
    parsePreToolUseStdin(raw) {
        return claudeCodeAdapter.parsePreToolUseStdin(raw);
    },
    parseUserPromptSubmitStdin(raw) {
        return claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
    },
    emitPreToolUse(decision) {
        return claudeCodeAdapter.emitPreToolUse(decision);
    },
    emitSessionStartContext(additionalContext) {
        return claudeCodeAdapter.emitSessionStartContext(additionalContext);
    },
    emitUserPromptSubmitContext(additionalContext) {
        return claudeCodeAdapter.emitUserPromptSubmitContext(additionalContext);
    },
    emitStop(reason) {
        return claudeCodeAdapter.emitStop(reason);
    },
};
//# sourceMappingURL=codex.js.map