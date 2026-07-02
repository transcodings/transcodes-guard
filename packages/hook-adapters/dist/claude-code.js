/**
 * Claude Code hook adapter (Codex delegates here; Cursor delegates parse only).
 *
 * PreToolUse stdin is mostly snake_case `tool_name` / `tool_input`. Cursor may
 * send a top-level `command` instead — we normalize locally; `rawPayload` is
 * forwarded verbatim to POST /guard/evaluate.
 */
function readString(v) {
    return typeof v === 'string' ? v : undefined;
}
function parsePreToolUsePayload(raw) {
    try {
        const payload = JSON.parse(raw);
        const command = readString(payload.command);
        const filePath = readString(payload.file_path);
        const toolName = readString(payload.tool_name) ??
            (command ? 'Shell' : filePath ? 'Read' : undefined) ??
            'Unknown';
        const toolInput = payload.tool_input ??
            payload.arguments ??
            (command ? { command } : filePath ? { path: filePath } : payload);
        return {
            toolName,
            toolInput,
            rawPayload: payload,
            cwd: readString(payload.cwd) ?? process.cwd(),
            sessionId: readString(payload.session_id),
            toolUseId: readString(payload.tool_use_id),
            hookEventName: readString(payload.hook_event_name),
        };
    }
    catch {
        return {
            toolName: 'Unknown',
            toolInput: { _raw: raw },
            rawPayload: { _raw: raw },
            cwd: process.cwd(),
        };
    }
}
export const claudeCodeAdapter = {
    host: 'claude',
    parsePreToolUseStdin: parsePreToolUsePayload,
    parseUserPromptSubmitStdin(raw) {
        const payload = JSON.parse(raw);
        return {
            prompt: readString(payload.prompt) ?? '',
            hookEventName: readString(payload.hook_event_name),
        };
    },
    emitPreToolUse(decision) {
        const hookSpecificOutput = {
            hookEventName: 'PreToolUse',
            permissionDecision: decision.kind === 'allow' ? 'allow' : 'deny',
            permissionDecisionReason: decision.reason,
            ...(decision.kind === 'allow' && decision.updatedInput !== undefined
                ? { updatedInput: decision.updatedInput }
                : {}),
        };
        return JSON.stringify({
            hookSpecificOutput,
            ...(decision.kind === 'deny' && decision.systemMessage !== undefined
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
        return JSON.stringify({ decision: 'block', reason });
    },
};
//# sourceMappingURL=claude-code.js.map