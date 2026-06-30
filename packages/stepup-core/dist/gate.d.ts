/**
 * Stable 16-hex fingerprint of a command/tool-call key. Shared by:
 *   - browser-launch dedup (this file), and
 *   - content-addressed verified/pending files (evaluate.ts + store.ts),
 * so the same danger command always resolves to the same fp across the
 * gate → poll → retry round-trip. 16 hex chars (64 bits) is collision-safe
 * for the per-session set of in-flight danger commands.
 */
export declare function fingerprintOf(key: string): string;
/** Open the step-up browser when this process wins the dedup lock. */
export declare function launchStepupBrowser(fingerprintKey: string, url: string): boolean;
export type RequestInput = {
    /** One-line human-readable summary surfaced in the deny JSON. */
    reason: string;
    /** Backend audit-log action identifier (e.g. "bash_exec", "retire_member"). */
    action: string;
    /** Backend audit-log resource identifier
     * (e.g. "transcodes-guard:pre-tool-use", "transcodes-guard:mcp:members"). */
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
    reason: 'no-token' | 'create-failed' | 'error';
    detail?: string;
};
/**
 * Create a step-up session and launch the browser. Returns sid + URL on
 * success so the hook can hand them to the agent. Does not poll — the
 * agent is responsible for calling `poll_stepup_session` and retrying.
 */
export declare function requestStepup(input: RequestInput): Promise<RequestResult>;
