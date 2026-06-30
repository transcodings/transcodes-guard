/**
 * Host-agnostic PreToolUse gate decision.
 *
 * Extracted from the original `plugins/ai-action-tracker/hooks/pre-tool-use.ts`
 * so every host's hook entrypoint can be a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision
 * shape drives Claude Code, Codex, and (later) Cursor/Antigravity.
 *
 * Fail policy:
 *  - Before classify (stdin parse) → return `{ kind: "proceed-ungated" }`
 *    (fail-open). Callers exit 0 with no JSON.
 *  - After classify (bash or mcp__*) → POST /guard/evaluate. Fail-closed:
 *    backend unreachable → permission 2 (step-up). Verified read / step-up
 *    create failures surface as `deny-*` decisions.
 */
import { type RbacAction } from '@transcodes-guard/danger-patterns';
import { type RequestResult } from './gate.js';
import { type PendingState } from './pending.js';
export interface ToolCallInput {
    toolName: string;
    toolInput: unknown;
    cwd: string;
}
export interface BlockResult {
    /** One-line danger summary surfaced in reason/systemMessage. */
    reason: string;
    /** Optional extra detail surfaced in reason/systemMessage. */
    details?: string[];
    /** Command / tool-call summary used in stderr logs and the pending file. */
    command: string;
    /** Synthetic audit id (e.g. guard-evaluate-bash). Feeds decision audit (H2). */
    ruleId: string;
    /** RBAC placeholder until `/guard/evaluate` returns the classified coordinate. */
    stepupResource: string;
    stepupAction: RbacAction;
}
/**
 * Runtime + type-level kind constants for `GateDecision`. Source of truth for
 * the discriminated union below and for every `switch`/comparison across the
 * codebase. Mirrored in `gate-contract/src/types.ts` (import firewall — the
 * two copies must stay in lockstep; the `gate-backend` drift alarm catches a
 * missed sync).
 */
export declare const GATE_DECISION_KIND: {
    readonly PROCEED_UNGATED: "proceed-ungated";
    readonly PROCEED_BY_POLICY: "proceed-by-policy";
    readonly PROCEED_BY_VERIFICATION: "proceed-by-verification";
    readonly BLOCK_NO_TOKEN: "block-no-token";
    readonly BLOCK_BY_POLICY: "block-by-policy";
    readonly BLOCK_STEPUP_CREATE_FAILED: "block-stepup-create-failed";
    readonly BLOCK_STEPUP_CHALLENGED: "block-stepup-challenged";
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
    kind: typeof GATE_DECISION_KIND.PROCEED_BY_VERIFICATION;
    block: BlockResult;
    /** True → the hook itself consumes the verified record (Bash + user
     * tool-rules). False → consume is deferred to the tool handler
     * (`withStepupVerifiedSid`) for MCP system rules. */
    consumeHere: boolean;
    /** Command fingerprint of the verified record to consume. Present
     * (and meaningful) only when `consumeHere` is true — that path uses
     * the FP-KEYED store. Omitted for the deferred MCP system path
     * (GLOBAL store). */
    fp?: string;
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
    failure: Extract<RequestResult, {
        ok: false;
    }>;
    reasoning?: string;
} | {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
    block: BlockResult;
    sid: string;
    browserUrl: string;
    browserLaunched: boolean;
    pending: PendingState;
    reasoning?: string;
};
/**
 * Run the full PreToolUse gate against a parsed tool call.
 *
 * Side effects performed here:
 *  - `POST /v1/guard/evaluate` (via `evaluateAction`).
 *  - `readVerified` reads from disk.
 *
 * Side effects intentionally NOT performed here (caller's responsibility):
 *  - `writePending(decision.pending)` — caller must call this AFTER
 *    emitting the deny JSON so a throw in writePending cannot suppress
 *    the deny on stdout (CLAUDE.md fail-safe rule).
 *  - `consumeVerified` + `clearPending` on allow — caller decides based on
 *    `decision.consumeHere`.
 */
export declare function evaluatePreToolUse(input: ToolCallInput): Promise<GateDecision>;
