export type RequestInput = {
    /** One-line human-readable summary surfaced in the deny JSON. */
    reason: string;
    /** Backend audit-log action identifier (e.g. "bash_exec", "retire_member"). */
    action: string;
    /** Backend audit-log resource identifier
     * (e.g. "ai-action-tracker:pre-tool-use", "ai-action-tracker:mcp:members"). */
    resource: string;
    /** Stable key for browser-launch deduplication. Bash → command; MCP →
     * `${toolName}:${JSON.stringify(tool_input)}`. */
    fingerprintKey: string;
    /** Override for the step-up UI comment. Defaults to `Confirm ${reason}`. */
    comment?: string;
};
export type RequestResult = {
    ok: true;
    sid: string;
    browserUrl: string;
    expiresAt?: string;
    launched: boolean;
} | {
    ok: false;
    reason: "no-token" | "create-failed" | "error";
    detail?: string;
};
/**
 * Create a step-up session and launch the browser. Returns sid + URL on
 * success so the hook can hand them to the agent. Does not poll — the
 * agent is responsible for calling `poll_stepup_session` and retrying.
 */
export declare function requestStepup(input: RequestInput): Promise<RequestResult>;
