import { type RequestResult } from "./gate.js";
import type { PendingState } from "./pending.js";
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
}
export type GateDecision = {
    kind: "pass";
} | {
    kind: "allow";
    block: BlockResult;
    consumeHere: boolean;
} | {
    kind: "deny-no-token";
    block: BlockResult;
} | {
    kind: "deny-stepup-failure";
    block: BlockResult;
    failure: Extract<RequestResult, {
        ok: false;
    }>;
} | {
    kind: "deny-stepup-pending";
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
