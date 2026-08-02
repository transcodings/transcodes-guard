/**
 * Claude Code hook adapter (Codex delegates here; Cursor delegates parse only).
 *
 * PreToolUse stdin is mostly snake_case `tool_name` / `tool_input`. Cursor may
 * send a top-level `command` instead — we normalize locally; `rawPayload` is
 * forwarded verbatim to POST /guard/evaluate.
 */
/**
 * Blank is absent. A host that sends `model: ""` means "no model", but an
 * empty string on the wire is a present field — `{$exists: false}` stays true
 * for it, so the backend cannot tell the two apart. Matches transcript.ts.
 */
function readString(v) {
    if (typeof v !== 'string')
        return undefined;
    const trimmed = v.trim();
    return trimmed ? trimmed : undefined;
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
            // Both identifiers below are read as a union of every name this parser
            // actually sees, not just Claude Code's. Codex and Cursor delegate here,
            // and — measured on prod — 89% of `provider=claude` traffic is Cursor
            // stdin (the claude-code plugin installed inside Cursor). Normalizing in
            // each host's own adapter would therefore miss the majority of Cursor
            // turns, since the cursor adapter never runs for that traffic. Cursor
            // names the session `conversation_id` (see cursor.ts), and a turn id
            // without the session it belongs to groups nothing.
            sessionId: readString(payload.session_id) ?? readString(payload.conversation_id),
            toolUseId: readString(payload.tool_use_id),
            promptId: readString(payload.prompt_id) ??
                readString(payload.turn_id) ??
                readString(payload.generation_id),
            // Claude Code alone reports no model — it sends `effort` instead.
            agentModel: readString(payload.model),
            transcriptPath: readString(payload.transcript_path),
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