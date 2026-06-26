import { type StepupConfig } from './config.js';
import { GATE_DECISION_KIND, type GateDecision } from './evaluate.js';
export declare const DECISION_AUDIT_TAG = "guard_gate_decision";
export declare const DECISION_AUDIT_TIMEOUT_MS = 1000;
/** The two recorded decision kinds (the MFA outcomes). */
export type RecordedDecisionKind = typeof GATE_DECISION_KIND.PROCEED_BY_VERIFICATION | typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
export type DecisionAuditEvent = {
    decision: RecordedDecisionKind;
    resource: string;
    action: string;
    ruleId: string;
    /** Command fingerprint (16-hex) when the decision carries one. */
    fp?: string;
};
/**
 * Map a gate decision onto its audit event. Returns null for every
 * non-recorded kind (gate-uninvolved, policy-only allow/deny, no-token,
 * step-up challenged-but-unfinished) and for the `block-stepup-create-failed`
 * branches that are not a backend explicit refusal (`reason === 'no-token'`
 * or `'error'`). Only the two MFA-outcome events are recorded.
 */
export declare function decisionAuditEventOf(decision: GateDecision): DecisionAuditEvent | null;
/**
 * POST the event to the backend audit module. Resolves on every outcome;
 * failures are logged to stderr and swallowed.
 */
export declare function sendDecisionAudit(config: StepupConfig, event: DecisionAuditEvent, opts?: {
    timeoutMs?: number;
}): Promise<void>;
/**
 * Config-less wrapper bound onto the GateBackend seam. The hook entrypoints
 * call this after emitting their decision; without a resolvable token (e.g.
 * the deny-no-token path, CI) it is a silent no-op.
 */
export declare function sendGateDecisionAudit(decision: GateDecision): Promise<void>;
