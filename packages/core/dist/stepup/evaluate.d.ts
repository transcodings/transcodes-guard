/**
 * Host-agnostic PreToolUse gate decision (Guard v3, backend-as-SSOT).
 *
 * Every host's hook entrypoint is a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision shape
 * drives Claude Code, Codex, Cursor, and Antigravity.
 *
 * Guard v3 grouping: every host tool call (except built-in transcodes-guard
 * MCP and host meta-tool bypass sets below) → `POST /guard/evaluate` with the
 * raw hook stdin JSON as `payload` and a client-minted per-prompt `sid`. The
 * backend is the single source of truth for step-up status; the client keeps
 * NO on-disk verified/pending records — only a per-coordinate latch (`latch.ts`)
 * that dedupes the browser launch across the N concurrent tool calls of one prompt.
 *
 * Fail policy:
 *  - Before classify (stdin parse) → `proceed-ungated` (fail-open); the caller
 *    exits 0 with no JSON.
 *  - After classify, no token → `block-no-token` (fail-closed).
 *  - After classify, backend unreachable / unparseable → permission 2
 *    (step-up); a null verdict without a session becomes
 *    `block-stepup-create-failed`.
 */
import { type RbacAction } from '../patterns/index.js';
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
    toolName?: string;
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
 * codebase. Mirrored in `../contract/types.ts` (transitional duplication, same
 * package — the two copies must stay in lockstep; the `gate-backend` drift
 * alarm catches a missed sync).
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
    reasoning?: string;
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
    /** Terminal: grouped challenge was rejected — stop polling, do not retry. */
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED;
    block: BlockResult;
    resource: string;
    action: string;
    reasoning?: string;
};
/**
 * Run the full PreToolUse gate against a parsed tool call.
 *
 * Side effects performed here (all crash-safe / never throw into the caller):
 *  - `POST /v1/guard/evaluate` (via `evaluateAction`).
 *  - resolve/mint the per-prompt grouping id (`resolvePromptGroup`).
 *  - on a step-up challenge: open the browser once per coordinate + write the
 *    latch. The stdout deny is emitted by the caller AFTER this returns, so a
 *    latch write cannot suppress the deny — and the latch write already swallows
 *    every error.
 */
export declare function evaluatePreToolUse(input: ToolCallInput): Promise<GateDecision>;
