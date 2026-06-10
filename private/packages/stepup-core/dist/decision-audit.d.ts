import { type StepupConfig } from './config.js';
import type { GateDecision } from './evaluate.js';
export declare const DECISION_AUDIT_TAG = "guard_gate_decision";
export declare const DECISION_AUDIT_TIMEOUT_MS = 1000;
export type DecisionAuditEvent = {
    decision: Exclude<GateDecision['kind'], 'pass'>;
    resource: string;
    action: string;
    ruleId: string;
    /** Command fingerprint (16-hex) when the decision carries one. */
    fp?: string;
};
/**
 * Map a gate decision onto its audit event. `pass` returns null — safe
 * commands are not audited (volume + privacy; the gate made no decision
 * worth recording).
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
