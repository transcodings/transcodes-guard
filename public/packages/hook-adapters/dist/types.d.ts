/**
 * Host-agnostic hook contract types.
 *
 * Each host (Claude Code, Codex CLI, Cursor, Antigravity) feeds its hooks
 * via stdin JSON with subtly different field names and accepts stdout JSON
 * in subtly different shapes. The PreToolUse decision itself is universal
 * (allow/deny + reason + optional rewrite), so we model the *decision*
 * once here and let each host adapter render it into wire format.
 */
/** Parsed PreToolUse stdin — same logical shape across hosts. */
export interface PreToolUseInput {
    toolName: string;
    toolInput: unknown;
    cwd: string;
    /** Optional, host-dependent. Present in Claude Code and Codex. */
    sessionId?: string;
    /** Optional, host-dependent invocation id (Codex `tool_use_id`). */
    toolUseId?: string;
    /** Echo of the hook event name when the host includes it. */
    hookEventName?: string;
}
/** Parsed UserPromptSubmit stdin. */
export interface UserPromptSubmitInput {
    prompt: string;
    hookEventName?: string;
}
/**
 * Parsed PreInvocation stdin — Antigravity-only.
 *
 * Antigravity has no SessionStart / UserPromptSubmit hook events; their
 * roles are folded into PreInvocation which fires before every model call.
 * `invocationNum === 1` is the per-turn analogue of SessionStart, and the
 * `transcriptPath` (JSONL of prior messages) lets the hook tail the most
 * recent user message to recover the UserPromptSubmit detection role.
 */
export interface PreInvocationInput {
    invocationNum: number;
    initialNumSteps: number;
    conversationId?: string;
    transcriptPath?: string;
    workspacePaths?: string[];
    artifactDirectoryPath?: string;
}
/**
 * Antigravity PreInvocation / PostInvocation `injectSteps` element shape.
 * The host materializes whichever variant is present into the conversation
 * trajectory before (PreInvocation) or after (PostInvocation) the model
 * call. We only currently use `ephemeralMessage`.
 */
export type InjectStep = {
    ephemeralMessage: string;
} | {
    userMessage: string;
} | {
    toolCall: {
        name: string;
        args: unknown;
    };
};
/** Universal PreToolUse decision the gate produces. */
export type PreToolUseDecision = {
    kind: 'allow';
    reason: string;
    /** MCP tool argument rewrite. Hosts that don't support it ignore. */
    updatedInput?: unknown;
} | {
    kind: 'deny';
    reason: string;
    /** Long-form text surfaced to the model (multi-line ok). */
    systemMessage?: string;
};
/**
 * Renders the universal decision/context shapes into a host's wire format.
 *
 * Implementations must:
 *  - Accept the raw stdin string and return parsed structures.
 *  - Return a JSON string ready to write to `process.stdout`. No newline.
 *  - Never throw on output emission — failures here would corrupt the
 *    JSON-RPC framing that some hosts impose.
 */
export interface HookAdapter {
    /** Display name for logs / diagnostics. */
    readonly host: string;
    /** Parse PreToolUse stdin JSON. Throws on parse error or missing tool_name. */
    parsePreToolUseStdin(raw: string): PreToolUseInput;
    /** Parse UserPromptSubmit stdin JSON. Throws on parse error. */
    parseUserPromptSubmitStdin(raw: string): UserPromptSubmitInput;
    /** Render PreToolUse decision (allow or deny) as stdout JSON. */
    emitPreToolUse(decision: PreToolUseDecision): string;
    /** Render a SessionStart additionalContext payload. */
    emitSessionStartContext(additionalContext: string): string;
    /** Render a UserPromptSubmit additionalContext payload. */
    emitUserPromptSubmitContext(additionalContext: string): string;
    /**
     * Render a Stop-hook block payload. Hosts vary on whether the wrapper
     * goes under `hookSpecificOutput` (Cursor) or top-level (Claude Code,
     * Codex). The adapter encapsulates that difference.
     */
    emitStop(reason: string): string;
    /**
     * Antigravity-only. Parse PreInvocation stdin JSON. Other hosts have no
     * PreInvocation hook event — they implement this only if/when they do.
     */
    parsePreInvocationStdin?(raw: string): PreInvocationInput;
    /**
     * Antigravity-only. Render a PreInvocation (or PostInvocation) inject-steps
     * payload. Returns `"{}"` when the array is empty so the hook can be a
     * no-op without violating the host's "stdout must be valid JSON" rule.
     */
    emitPreInvocation?(injectSteps: InjectStep[]): string;
}
