/**
 * RBAC permission-matrix lookup for the PreToolUse gate.
 *
 * After a pattern/tool-rule matches and yields a (resource, action) coordinate,
 * the gate asks the backend what the project's RBAC matrix says for the token's
 * member: 0 = deny, 1 = allow (no step-up), 2 = allow + step-up. This makes the
 * RBAC matrix the single authority for the decision; the local rule only maps a
 * command/tool onto a coordinate.
 *
 * `evaluateAction` returns a `GuardEvaluateFailure` carrying the HTTP status +
 * backend error text on failure, so the hook can surface WHY the gate failed
 * (issue #189). Callers MUST fail-closed — treat any failure as step-up
 * required (2), never as allow.
 */
import { type GuardProvider } from '../patterns/index.js';
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
     *   exist  — evaluate reused an existing `step-up-session:{sid}`.
     *   status — live session status (poll via GET .../session/:sid).
     */
    exist: boolean;
    status: GuardStepUpStatus | null;
};
/**
 * Why `POST /guard/evaluate` could not produce a verdict.
 *  - `network`   — request never got an HTTP response (status 0; timeout/DNS/refused).
 *  - `http`      — backend answered non-2xx (status + backend error text preserved).
 *  - `malformed` — 2xx but the payload did not parse into a `GuardVerdict`.
 */
export type GuardEvaluateFailure = {
    ok: false;
    kind: 'network' | 'http' | 'malformed';
    status: number;
    /** Backend envelope `message`/`error` (+ `logId` for backend log correlation). */
    message?: string | undefined;
};
export type GuardEvaluateResult = {
    ok: true;
    verdict: GuardVerdict;
} | GuardEvaluateFailure;
/**
 * Pull human-readable failure text out of the backend error envelope.
 * Handles the exception-filter shape (`error` + `logId`), NestJS validation
 * arrays (`message: string[]`), and sanitizes/caps the result. Also consumed
 * by gate-backend's 403 → `STEP_UP_REQUIRED` translation (`wrapProtectedTool`).
 */
export declare function extractFailureMessage(data: unknown): string | undefined;
/**
 * POST /v1/guard/evaluate — one round-trip: backend classifies the raw hook
 * payload, applies the matrix, and (for level 2) creates or reuses the
 * member-scoped coordinate step-up session. Every tool call (except built-in
 * transcodes-guard MCP) reaches this path. On any failure returns a
 * `GuardEvaluateFailure` (never a verdict) → caller fails closed and surfaces
 * the failure detail in the deny message.
 */
export declare function evaluateAction(config: StepupConfig, body: {
    payload: unknown;
    /** Wire tool name resolved from the host hook shape (plugin-side). */
    toolName?: string | undefined;
    cwd?: string | undefined;
    provider?: GuardProvider | undefined;
    /** Host conversation/session id — groups one work session. */
    sessionId?: string | undefined;
    /** Host id for this single tool invocation. Absent on Antigravity. */
    toolUseId?: string | undefined;
    /** One user instruction, normalized across the four host field names. */
    promptId?: string | undefined;
    /** Model driving the calling agent — not the backend classifier's model. */
    agentModel?: string | undefined;
    /** Client-built summary of the work in flight. DATA, like `payload`. */
    tasks?: string | undefined;
}): Promise<GuardEvaluateResult>;
