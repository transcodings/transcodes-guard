import type { StepupConfig } from './config.js';
export type RbacLevel = 0 | 1 | 2;
export type GuardVerdict = {
    permission: RbacLevel;
    resource: string;
    action: string;
    reasoning: string;
    /** Where the verified sid is re-enforced. null when the backend omitted it. */
    consume_in_hook: boolean | null;
    sid: string | null;
    url: string | null;
    expires_at: string | null;
};
/**
 * POST /v1/guard/evaluate — one round-trip: backend classifies the raw
 * tool_input, applies the matrix, and (for level 2) creates the step-up
 * session. The local rule only decided *whether* to gate; resource/action/
 * permission come from here. Returns null on any failure → caller fails closed.
 */
export declare function evaluateAction(config: StepupConfig, body: {
    toolName?: string;
    toolInput: unknown;
    cwd?: string;
    comment?: string;
}): Promise<GuardVerdict | null>;
export declare function checkRbacPermission(config: StepupConfig, resource: string, action: string): Promise<RbacLevel | null>;
