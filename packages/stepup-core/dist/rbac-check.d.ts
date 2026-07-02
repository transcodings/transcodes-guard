import type { StepupConfig } from './config.js';
export type RbacLevel = 0 | 1 | 2;
export type GuardVerdict = {
    permission: RbacLevel;
    resource: string;
    action: string;
    reasoning: string;
    /** Where the verified sid gets re-enforced (mirrors EvaluateActionResponseDto). */
    consume_in_hook: boolean;
    sid: string | null;
    url: string | null;
    expires_at: string | null;
};
/**
 * POST /v1/guard/evaluate — one round-trip: backend classifies the raw hook
 * payload, applies the matrix, and (for level 2) creates the step-up session.
 * Every tool call (except built-in transcodes-guard MCP) reaches this path.
 * Returns null on any failure → caller fails closed.
 */
export declare function evaluateAction(config: StepupConfig, body: {
    payload: unknown;
    /** Wire tool name resolved from the host hook shape (plugin-side). */
    toolName?: string;
    cwd?: string;
    comment?: string;
}): Promise<GuardVerdict | null>;
export declare function checkRbacPermission(config: StepupConfig, resource: string, action: string): Promise<RbacLevel | null>;
