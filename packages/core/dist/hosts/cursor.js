/**
 * Cursor IDE hook adapter.
 *
 * Cursor uses a native wire format documented at cursor.com/docs/agent/hooks
 * (verified 2026-05-27). Key divergences vs Claude Code:
 *
 *  - stdin: snake_case `tool_name` / `tool_input` / `cwd` / `conversation_id`
 *    — same shape as Claude Code, so parse logic delegates to claudeCodeAdapter.
 *  - PreToolUse stdout: FLAT `{ permission, user_message?, agent_message?, updated_input? }`
 *    — no `hookSpecificOutput` wrapper, no `permissionDecisionReason`.
 *    `user_message` is shown as a UI toast, `agent_message` is fed back into
 *    the model's context; our reason/systemMessage split maps naturally.
 *  - beforeShellExecution / beforeMCPExecution: same flat shape but also
 *    accepts `permission: "ask"`. We emit `allow`/`deny` only.
 *  - SessionStart stdout: `{ additional_context?, env? }` (snake_case).
 *  - UserPromptSubmit equivalent (`beforeSubmitPrompt`): has NO context
 *    injection channel — only `{ continue, user_message? }`. The
 *    `emitUserPromptSubmitContext` method below throws to surface wiring
 *    bugs; the matching hook entry handles user "auth done" prompts via
 *    side effects only (consumeVerified + clearPending).
 *  - Stop stdout: `{ followup_message? }` — Claude Code's `{ decision: "block",
 *    reason }` semantic, different key name.
 *
 * Gate hooks are wired as `beforeShellExecution` + `beforeMCPExecution` in
 * `.cursor/hooks.json` — one binary serves both events.
 */
import { claudeCodeAdapter } from './claude-code.js';
export const cursorAdapter = {
    host: 'cursor',
    parsePreToolUseStdin(raw) {
        return claudeCodeAdapter.parsePreToolUseStdin(raw);
    },
    parseUserPromptSubmitStdin(raw) {
        return claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
    },
    emitPreToolUse(decision) {
        if (decision.kind === 'allow') {
            return JSON.stringify({
                permission: 'allow',
                ...(decision.updatedInput !== undefined
                    ? { updated_input: decision.updatedInput }
                    : {}),
            });
        }
        return JSON.stringify({
            permission: 'deny',
            user_message: decision.reason,
            agent_message: decision.systemMessage ?? decision.reason,
        });
    },
    emitSessionStartContext(additionalContext) {
        return JSON.stringify({ additional_context: additionalContext });
    },
    emitUserPromptSubmitContext(_additionalContext) {
        // Cursor's beforeSubmitPrompt has no additional_context channel — its
        // only outputs are `continue` (allow/block submission) and a
        // user-facing toast. The hook entry should perform consume/clear side
        // effects directly and emit `{ continue: true }`. Reaching this stub
        // indicates the entry script wrongly routed an additionalContext path.
        throw new Error("Cursor's beforeSubmitPrompt has no additional_context channel. " +
            'Perform consumeVerified/clearPending as side effects and emit `{ continue: true }` directly.');
    },
    emitStop(reason) {
        if (!reason)
            return '{}';
        return JSON.stringify({ followup_message: reason });
    },
};
//# sourceMappingURL=cursor.js.map