/**
 * RBAC permission-matrix lookup for the PreToolUse gate.
 *
 * After a pattern/tool-rule matches and yields a (resource, action) coordinate,
 * the gate asks the backend what the project's RBAC matrix says for the token's
 * member: 0 = deny, 1 = allow (no step-up), 2 = allow + step-up. This makes the
 * RBAC matrix the single authority for the decision; the local rule only maps a
 * command/tool onto a coordinate.
 *
 * Backend route: POST /v1/auth/role/check-permission
 *   body  { member_id, resource, action, project_id }
 *   reply { data: { payload: [ { permission: 0|1|2, resource, action } ] } }
 *
 * Returns `null` when the decision cannot be determined (network/parse
 * failure). Callers MUST fail-closed — treat `null` as step-up required (2),
 * never as allow.
 */
import { type GuardProvider } from '@transcodes-guard/danger-patterns';
import type { StepupConfig } from './config.js';
export type RbacLevel = 0 | 1 | 2;
export type GuardStepUpStatus = 'pending' | 'verified' | 'rejected';
export type GuardVerdict = {
    permission: RbacLevel;
    resource: string;
    action: string;
    reasoning: string;
    summary: string;
    provider: GuardProvider | null;
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
    provider?: GuardProvider;
    /** Client-minted per-prompt grouping id (Guard v3). */
    sid?: string;
}): Promise<GuardVerdict | null>;
export declare function checkRbacPermission(config: StepupConfig, resource: string, action: string): Promise<RbacLevel | null>;
