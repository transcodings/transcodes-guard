/**
 * Host-agnostic user-facing text for PreToolUse decisions.
 *
 * Each host's hook entrypoint calls these formatters to fill in `reason`
 * and `systemMessage` on its adapter's `emitPreToolUse(...)`. The strings
 * here are stable across hosts because the agent-facing protocol
 * instructions don't depend on which CLI ran the hook.
 */
import type { BlockResult, GateDecision } from "./evaluate.js";
/**
 * Session-start notice text shown when no Transcodes token is configured.
 *
 * Pure formatter — it does NOT decide whether to show itself. The caller is
 * responsible for the token lookup (`resolveToken().token`) and only renders
 * this when no token is found. Keeping the env/file I/O out of this module
 * preserves it as host-agnostic *text* (see file header); all four hosts
 * share this one wording. Nudges first-time users toward `transcodes login`
 * BEFORE they hit a blocked command. The token must be set in a terminal,
 * never pasted into the agent chat (that would leak it into the transcript).
 */
export declare function formatNoTokenSessionNotice(): string;
export declare function formatBlockedSummary(block: BlockResult): string;
export declare function formatAllowReason(decision: Extract<GateDecision, {
    kind: "allow";
}>): string;
export declare function formatNoTokenReason(block: BlockResult): string;
export declare function formatNoTokenSystemMessage(block: BlockResult): string;
export declare function formatRbacDeniedReason(decision: Extract<GateDecision, {
    kind: "deny-rbac-denied";
}>): string;
export declare function formatRbacDeniedSystemMessage(decision: Extract<GateDecision, {
    kind: "deny-rbac-denied";
}>): string;
export declare function formatStepupFailureDetail(decision: Extract<GateDecision, {
    kind: "deny-stepup-failure";
}>): string;
export declare function formatStepupFailureReason(decision: Extract<GateDecision, {
    kind: "deny-stepup-failure";
}>): string;
export declare function formatStepupFailureSystemMessage(decision: Extract<GateDecision, {
    kind: "deny-stepup-failure";
}>): string;
export declare function formatStepupPendingReason(decision: Extract<GateDecision, {
    kind: "deny-stepup-pending";
}>): string;
export declare function formatStepupPendingSystemMessage(decision: Extract<GateDecision, {
    kind: "deny-stepup-pending";
}>): string;
/**
 * Stderr 1-line summary tag for the hook process. Distinct from the
 * stdout JSON — this surface lands directly in the terminal under each
 * host's hook log channel.
 */
export declare function formatStderrTag(decision: GateDecision): string;
