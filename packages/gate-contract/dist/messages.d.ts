/**
 * Host-agnostic user-facing text for PreToolUse decisions.
 *
 * Each host's hook entrypoint calls these formatters to fill in `reason`
 * and `systemMessage` on its adapter's `emitPreToolUse(...)`. The strings
 * here are stable across hosts because the agent-facing protocol
 * instructions don't depend on which CLI ran the hook.
 *
 * These live in gate-contract (public) — they are pure text formatters over
 * the `GateDecision` shape, carry no backend coupling, and let every host hook
 * render decisions without importing private code.
 */
import { type BlockResult, GATE_DECISION_KIND, type GateDecision } from './types.js';
/**
 * Session-start notice text shown when no Transcodes token is configured.
 *
 * Pure formatter — it does NOT decide whether to show itself. The caller is
 * responsible for the token lookup (`backend.hasToken()`) and only renders
 * this when no token is found.
 */
export declare function formatNoTokenSessionNotice(): string;
export declare function formatBlockedSummary(block: BlockResult): string;
export declare function formatAllowReason(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.PROCEED_BY_VERIFICATION;
}>): string;
export declare function formatNoTokenReason(block: BlockResult): string;
export declare function formatNoTokenSystemMessage(block: BlockResult): string;
export declare function formatRbacDeniedReason(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY;
}>): string;
export declare function formatRbacDeniedSystemMessage(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY;
}>): string;
export declare function formatStepupFailureDetail(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
}>): string;
export declare function formatStepupFailureReason(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
}>): string;
export declare function formatStepupFailureSystemMessage(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
}>): string;
export declare function formatStepupPendingReason(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
}>): string;
export declare function formatStepupPendingSystemMessage(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
}>): string;
/**
 * Stderr 1-line summary tag for the hook process. Distinct from the
 * stdout JSON — this surface lands directly in the terminal under each
 * host's hook log channel.
 */
export declare function formatStderrTag(decision: GateDecision): string;
