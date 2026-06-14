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
    /** Optional per-target detail (e.g. git-tracked file samples). */
    details?: string[];
    /** Command / tool-call summary used in stderr logs and the pending file. */
    command: string;
    /** Id of the matched pattern/tool-rule (or a synthetic id for built-in
     * semantic checks). Feeds the decision audit (H2) — never the raw command. */
    ruleId: string;
    /** RBAC step-up coordinate of the matched rule. Always resolved by the
     * producer (pattern/tool-rule are coerced on load; the git-tracked check
     * hard-codes system/delete) so the gate can consult the matrix directly. */
    stepupResource: string;
    stepupAction: RbacAction;
}
export type GateDecision = {
    kind: 'pass';
} | {
    kind: 'allow';
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
    kind: 'deny-no-token';
    block: BlockResult;
} | {
    /** RBAC matrix returned permission 0 (deny) for this resource+action.
     * Step-up cannot help — the member's role has no access. Hard block. */
    kind: 'deny-rbac-denied';
    block: BlockResult;
    resource: string;
    action: string;
} | {
    kind: 'deny-stepup-failure';
    block: BlockResult;
    failure: Extract<RequestResult, {
        ok: false;
    }>;
} | {
    kind: 'deny-stepup-pending';
    block: BlockResult;
    sid: string;
    browserUrl: string;
    browserLaunched: boolean;
    pending: PendingState;
};
/**
 * Run the full PreToolUse gate against a parsed tool call.
 *
 * Side effects performed here:
 *  - `requestStepup` creates a backend session and may launch a browser.
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
