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
function readString(v) {
    return typeof v === 'string' ? v : undefined;
}
export const claudeCodeAdapter = {
    host: 'claude',
    parsePreToolUseStdin(raw) {
        const payload = JSON.parse(raw);
        const toolName = readString(payload.tool_name);
        if (!toolName)
            throw new Error('PreToolUse payload missing tool_name');
        return {
            toolName,
            toolInput: payload.tool_input,
            cwd: readString(payload.cwd) ?? process.cwd(),
            sessionId: readString(payload.session_id),
            toolUseId: readString(payload.tool_use_id),
            hookEventName: readString(payload.hook_event_name),
        };
    },
    parseUserPromptSubmitStdin(raw) {
        const payload = JSON.parse(raw);
        return {
            prompt: readString(payload.prompt) ?? '',
            hookEventName: readString(payload.hook_event_name),
        };
    },
    emitPreToolUse(decision) {
        if (decision.kind === 'allow') {
            return JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'allow',
                    permissionDecisionReason: decision.reason,
                    ...(decision.updatedInput !== undefined
                        ? { updatedInput: decision.updatedInput }
                        : {}),
                },
            });
        }
        return JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: decision.reason,
            },
            ...(decision.systemMessage !== undefined
                ? { systemMessage: decision.systemMessage }
                : {}),
        });
    },
    emitSessionStartContext(additionalContext) {
        return JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext,
            },
        });
    },
    emitUserPromptSubmitContext(additionalContext) {
        return JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
                additionalContext,
            },
        });
    },
    emitStop(reason) {
        // Top-level decision: Stop is excluded from the hookSpecificOutput enum
        // in Claude Code's validator, so wrapping rejects the payload.
        return JSON.stringify({
            decision: 'block',
            reason,
        });
    },
};
//# sourceMappingURL=claude-code.js.map