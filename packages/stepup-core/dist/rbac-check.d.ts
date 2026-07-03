import type { StepupConfig } from './config.js';
export type RbacLevel = 0 | 1 | 2;
export type GuardStepUpStatus = 'pending' | 'verified' | 'rejected';
export type GuardVerdict = {
    permission: RbacLevel;
    resource: string;
    action: string;
    reasoning: string;
    sid: string | null;
    url: string | null;
    expires_at: string | null;
    /**
     * Guard v3 grouping (from evaluate, sourced from step-up-session SSOT):
     *   exist  — a sibling already created this coordinate's authSid.
     *   status — live session status (poll the same authSid via GET .../session/:sid).
     */
    exist: boolean;
    status: GuardStepUpStatus | null;
};
/**
 * POST /v1/guard/evaluate — one round-trip: backend classifies the raw hook
 * payload, applies the matrix, and (for level 2) creates or reuses the grouped
 * step-up session keyed on `sid`. Every tool call (except built-in
 * transcodes-guard MCP) reaches this path. Returns null on any failure →
 * caller fails closed.
 */
export declare function evaluateAction(config: StepupConfig, body: {
    payload: unknown;
    /** Wire tool name resolved from the host hook shape (plugin-side). */
    toolName?: string;
    cwd?: string;
    comment?: string;
    /** Client-minted per-prompt grouping id (Guard v3). */
    sid?: string;
}): Promise<GuardVerdict | null>;
export declare function checkRbacPermission(config: StepupConfig, resource: string, action: string): Promise<RbacLevel | null>;
