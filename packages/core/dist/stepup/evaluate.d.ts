/**
 * Host-agnostic PreToolUse gate decision (Guard v3, backend-as-SSOT).
 *
 * Every host's hook entrypoint is a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision shape
 * drives Claude Code, Codex, Cursor, and Antigravity.
 *
 * Guard v3: every host tool call (except built-in transcodes-guard MCP and host
 * meta-tool bypass sets below) → `POST /guard/evaluate` with the raw hook stdin
 * JSON as `payload`. Backend reuses MFA via Redis
 * `stepup:{projectId}:{memberId}:{resource}:{action}`. Client opens the browser
 * only when `exist:false` (fresh mint); no local latch / prompt group.
 *
 * Fail policy:
 *  - Before classify (stdin parse) → `proceed-ungated` (fail-open); the caller
 *    exits 0 with no JSON.
 *  - After classify, no token → `block-no-token` (fail-closed).
 *  - After classify, backend unreachable / unparseable → permission 2
 *    (step-up); a failed evaluate without a session becomes
 *    `block-stepup-create-failed`, carrying the HTTP status / backend error
 *    text in `failure.detail` so the deny is diagnosable (issue #189).
 */
import { type GuardProvider, type RbacAction } from '../patterns/index.js';
export interface ToolCallInput {
    toolName: string;
    toolInput: unknown;
    /** Original hook stdin JSON — sent verbatim as POST /guard/evaluate payload. */
    rawPayload?: unknown;
    cwd: string;
    hookEventName?: string;
}
export interface BlockResult {
    /** One-line summary surfaced in reason/systemMessage. */
    reason: string;
    /** Optional extra detail surfaced in reason/systemMessage. */
    details?: string[];
    /** Command / tool-call summary used in stderr logs. */
    command: string;
    /** Wire tool name (`Bash`, `mcp__…`). Feeds decision audit metadata. */
    toolName?: string | undefined;
    /** Synthetic audit id. Feeds decision audit (H2). */
    ruleId: string;
    /** RBAC placeholder until `/guard/evaluate` returns the classified coordinate. */
    stepupResource: string;
    stepupAction: RbacAction;
}
/** The `ok: false` shape returned when a step-up session cannot be created. */
export type StepupFailure = {
    ok: false;
    reason: 'no-token' | 'create-failed' | 'error';
    detail?: string;
};
/**
 * Runtime + type-level kind constants for `GateDecision`. Source of truth for
 * the discriminated union below and every `switch`/comparison across the
 * codebase. Re-exported as the contract surface (`../contract/types.ts`) —
 * changing this constant or the union changes the GateBackend contract.
 */
export declare const GATE_DECISION_KIND: {
    readonly PROCEED_UNGATED: "proceed-ungated";
    readonly PROCEED_BY_POLICY: "proceed-by-policy";
    readonly BLOCK_NO_TOKEN: "block-no-token";
    readonly BLOCK_BY_POLICY: "block-by-policy";
    readonly BLOCK_STEPUP_CREATE_FAILED: "block-stepup-create-failed";
    readonly BLOCK_STEPUP_CHALLENGED: "block-stepup-challenged";
    /** Terminal: user declined MFA for this grouped challenge — do not poll/retry. */
    readonly BLOCK_STEPUP_REJECTED: "block-stepup-rejected";
};
export type GateDecision = {
    kind: typeof GATE_DECISION_KIND.PROCEED_UNGATED;
} | {
    kind: typeof GATE_DECISION_KIND.PROCEED_BY_POLICY;
    block: BlockResult;
    resource: string;
    action: string;
    /** Backend `/guard/evaluate` classification + matrix explanation. */
    reasoning?: string | undefined;
} | {
    kind: typeof GATE_DECISION_KIND.BLOCK_NO_TOKEN;
    block: BlockResult;
} | {
    /** RBAC matrix returned permission 0 (deny) for this resource+action.
     * Step-up cannot help — the member's role has no access. Hard block. */
    kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY;
    block: BlockResult;
    resource: string;
    action: string;
    reasoning?: string | undefined;
} | {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
    block: BlockResult;
    failure: StepupFailure;
    reasoning?: string | undefined;
} | {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
    block: BlockResult;
    /** Backend-minted auth session id (tc_stepup_…) for poll + retry. */
    sid: string;
    browserUrl: string;
    browserLaunched: boolean;
    /** Classified coordinate — the backend's reuse key for this challenge. */
    resource: string;
    action: string;
    reasoning?: string | undefined;
} | {
    /** Terminal: grouped challenge was rejected — skip this command; other work may continue. */
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED;
    block: BlockResult;
    resource: string;
    action: string;
    reasoning?: string | undefined;
};
export type Classified = {
    summary: string;
};
/**
 * The built-in binary decision (toolgate t2, narrowed by t9): a call is
 * skipped iff its wire name is a step-up meta tool (the 4-name recovery
 * loop) or in the host's static builtin-exempt list — everything else,
 * non-meta tc_* tools included, goes to POST /guard/evaluate.
 * Exported for the §3 acceptance-matrix unit tests; production callers go
 * through `evaluatePreToolUse`.
 */
export declare function classifyToolCall(input: ToolCallInput, provider: GuardProvider | undefined): Classified | null;
/**
 * Run the full PreToolUse gate against a parsed tool call.
 *
 * Side effects performed here (all crash-safe / never throw into the caller):
 *  - `POST /v1/guard/evaluate` (via `evaluateAction`).
 *  - on a fresh step-up challenge (`exist:false`): open the browser once.
 *    Concurrent hooks rely on backend coordinate claim (SET NX) for dedupe —
 *    no local latch / prompt group.
 */
export declare function evaluatePreToolUse(input: ToolCallInput): Promise<GateDecision>;
