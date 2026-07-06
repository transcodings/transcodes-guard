/**
 * Shared wire types for the step-up gate DI boundary.
 *
 * These mirror the structural shapes defined inside the private packages
 * (`@transcodes-guard/core/stepup`, `.../danger-patterns`). TypeScript is
 * structural, so the private adapter (`@transcodes-guard/gate-backend`)
 * satisfies `GateBackend` by assigning the real functions directly — the
 * `transcodesGateBackend: GateBackend` annotation makes the compiler enforce
 * that these shapes stay in sync. If a private shape drifts, the adapter build
 * fails loudly.
 *
 * The public side (hooks + mcp-server-core) imports only these types, never the
 * private packages, so it type-checks and builds standalone.
 */
import type { MergedPattern, RbacAction } from '../patterns/index.js';
export type { MergedPattern, RbacAction };
/** A parsed PreToolUse tool call (host-neutral). Mirrors evaluate.ts. */
export interface ToolCallInput {
    toolName: string;
    toolInput: unknown;
    rawPayload?: unknown;
    cwd: string;
    hookEventName?: string;
}
/** Resolved danger match + its RBAC step-up coordinate. Mirrors evaluate.ts. */
export interface BlockResult {
    reason: string;
    details?: string[];
    command: string;
    /** Wire tool name (`Bash`, `mcp__…`). Feeds decision audit metadata. */
    toolName?: string;
    /** Id of the matched pattern/tool-rule. Feeds the decision audit (H2). */
    ruleId: string;
    stepupResource: string;
    stepupAction: RbacAction;
}
/** The `ok: false` half of stepup-core's evaluate.ts `StepupFailure`. */
export type StepupFailure = {
    ok: false;
    reason: 'no-token' | 'create-failed' | 'error';
    detail?: string;
};
/** RBAC permission level: 0 deny, 1 allow, 2 allow+step-up. Mirrors rbac-check.ts. */
export type RbacLevel = 0 | 1 | 2;
/**
 * Runtime + type-level kind constants for `GateDecision`. Source of truth
 * for the discriminated union below. Mirrored in `stepup-core/src/evaluate.ts`
 * (import firewall — the two copies must stay in lockstep; the `gate-backend`
 * drift alarm catches a missed sync).
 */
export declare const GATE_DECISION_KIND: {
    readonly PROCEED_UNGATED: "proceed-ungated";
    readonly PROCEED_BY_POLICY: "proceed-by-policy";
    readonly BLOCK_NO_TOKEN: "block-no-token";
    readonly BLOCK_BY_POLICY: "block-by-policy";
    readonly BLOCK_STEPUP_CREATE_FAILED: "block-stepup-create-failed";
    readonly BLOCK_STEPUP_CHALLENGED: "block-stepup-challenged";
    readonly BLOCK_STEPUP_REJECTED: "block-stepup-rejected";
};
/** Host-agnostic PreToolUse gate decision. Mirrors evaluate.ts `GateDecision`. */
export type GateDecision = {
    kind: typeof GATE_DECISION_KIND.PROCEED_UNGATED;
} | {
    kind: typeof GATE_DECISION_KIND.PROCEED_BY_POLICY;
    block: BlockResult;
    resource: string;
    action: string;
    /** Backend `/guard/evaluate` classification + matrix explanation. */
    reasoning?: string;
} | {
    kind: typeof GATE_DECISION_KIND.BLOCK_NO_TOKEN;
    block: BlockResult;
} | {
    kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY;
    block: BlockResult;
    resource: string;
    action: string;
    reasoning?: string;
} | {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
    block: BlockResult;
    failure: StepupFailure;
    reasoning?: string;
} | {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
    block: BlockResult;
    /** Backend-minted auth session id (tc_stepup_…) for poll + retry. */
    sid: string;
    browserUrl: string;
    browserLaunched: boolean;
    /** Classified coordinate (also the local latch key). */
    resource: string;
    action: string;
    reasoning?: string;
} | {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED;
    block: BlockResult;
    resource: string;
    action: string;
    reasoning?: string;
};
/** Backend HTTP envelope. Mirrors client.ts `Envelope`. */
export type Envelope = {
    ok: boolean;
    status: number;
    data: unknown;
};
/** Args for creating a step-up session. Mirrors session.ts `CreateStepupArgs`. */
export type CreateStepupArgs = {
    summary: string;
    action?: string;
    resource?: string;
    member_id?: string;
    /** @deprecated Use `summary`. */
    comment?: string;
};
/** Mirrors session.ts `CreatedStepupSession`. */
export type CreatedStepupSession = {
    envelope: Envelope;
    sid?: string;
    browserUrl?: string;
    expiresAt?: string;
    mode?: string;
};
/** Mirrors session.ts `PollStepupResult`. */
export type PollStepupResult = {
    envelope: Envelope;
    status?: string;
};
/** Mirrors session.ts `WaitStepupResult`. */
export type WaitStepupResult = {
    envelope: Envelope;
    /** verified/rejected/not_found = terminal; timeout = keep waiting (re-poll). */
    outcome: 'verified' | 'rejected' | 'not_found' | 'timeout';
    elapsedMs: number;
    attempts: number;
};
/**
 * Step-up state inspection snapshot (Guard v3). Mirrors stepup-core's
 * `inspector.ts`. The client holds only the per-prompt grouping id and the
 * per-coordinate browser latches — all step-up *status* lives in the backend.
 */
export interface LatchInspection {
    group: string;
    resource: string;
    action: string;
    created_at_ms: number;
    age_ms: number;
    expired: boolean;
}
export interface StepupStateInspection {
    cache_dir: string;
    now_ms: number;
    ttl_ms: number;
    prompt_group: string | null;
    latches: LatchInspection[];
}
/**
 * Outcome of a forced policy-bundle refresh. Mirrors stepup-core's
 * `PolicyBundleRefreshOutcome` plus `'skipped'` (no resolvable token):
 *  - `fresh` / `refreshed` — cache now holds the latest bundle.
 *  - `not-modified` — backend confirmed the cache is already current.
 *  - `failed` — fetch failed; the previous cache (last-known-good) is kept.
 *  - `skipped` — no token configured, nothing to refresh.
 */
export type PolicyBundleRefreshOutcome = 'fresh' | 'refreshed' | 'not-modified' | 'failed' | 'skipped';
/** Tool-rule registry types. Mirror danger-patterns tool-rules.ts (schema v2). */
export type GuardMatcher = 'exact' | 'glob' | 'regex';
export type GuardProvider = 'claude' | 'codex' | 'cursor' | 'antigravity' | 'web';
export type ToolRuleSource = 'system' | 'bundle';
export interface ToolRule {
    id: string;
    type: 'mcp' | 'bash';
    label: string;
    description: string;
    name: string;
    matcher: GuardMatcher;
    /** Optional MCP host label — scopes matching to that host (absent ⇒ every host). */
    provider?: GuardProvider;
    action?: RbacAction;
    resource?: string;
    /** Hook consumes FP-keyed verified record when true (default: bundle=true, system=false). */
    consume_in_hook?: boolean;
}
export interface MergedToolRule extends ToolRule {
    source: ToolRuleSource;
}
export interface ToolRuleMatch {
    matched: MergedToolRule;
}
export interface ToolRuleInput {
    id: string;
    type?: 'mcp' | 'bash';
    label: string;
    description: string;
    name: string;
    matcher?: GuardMatcher;
    provider?: GuardProvider;
    action?: string;
    resource?: string;
    status?: 'active' | 'inactive';
    metadata?: Record<string, unknown>;
}
export interface ToolRuleChanges {
    type?: 'mcp' | 'bash';
    label?: string;
    description?: string;
    name?: string;
    matcher?: GuardMatcher;
    provider?: GuardProvider;
    action?: string;
    resource?: string;
    status?: 'active' | 'inactive';
    metadata?: Record<string, unknown>;
}
