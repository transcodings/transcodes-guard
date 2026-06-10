/**
 * Gate decision audit — fire-and-forget visibility (Phase 3 v2 Unit H, H2).
 *
 * Every non-pass gate decision (deny / step-up pending / allow-by-verified)
 * is reported to the backend's existing generic audit module
 * (`POST /v1/audit/logs`, src/audit/ in transcode-backend-nestjs-v1) under
 * the `guard_gate_decision` tag. Evasion-attempt visibility is the
 * compensating control for publishing the policy data (PRD §6).
 *
 * Invariants:
 *  - NEVER blocks or fails the gate: callers invoke this AFTER the decision
 *    JSON is on stdout; every failure path resolves silently (stderr note).
 *  - Sub-second timeout — the hook process must not linger on an
 *    unreachable backend.
 *  - Sends coordinates/decision/rule id/fp only. The raw command string is
 *    deliberately excluded (data minimisation — fp already identifies it).
 */
import { request } from './client.js';
import { loadStepupConfig, type StepupConfig } from './config.js';
import type { GateDecision } from './evaluate.js';

export const DECISION_AUDIT_TAG = 'guard_gate_decision';
export const DECISION_AUDIT_TIMEOUT_MS = 1_000;

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
export function decisionAuditEventOf(
  decision: GateDecision,
): DecisionAuditEvent | null {
  if (decision.kind === 'pass') return null;
  return {
    decision: decision.kind,
    resource: decision.block.stepupResource,
    action: decision.block.stepupAction,
    ruleId: decision.block.ruleId,
    ...(decision.kind === 'allow' && decision.fp ? { fp: decision.fp } : {}),
    ...(decision.kind === 'deny-stepup-pending' && decision.pending.fp
      ? { fp: decision.pending.fp }
      : {}),
  };
}

/**
 * POST the event to the backend audit module. Resolves on every outcome;
 * failures are logged to stderr and swallowed.
 */
export async function sendDecisionAudit(
  config: StepupConfig,
  event: DecisionAuditEvent,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  try {
    const env = await request(config, {
      method: 'POST',
      path: '/audit/logs',
      timeoutMs: opts.timeoutMs ?? DECISION_AUDIT_TIMEOUT_MS,
      body: {
        project_id: config.projectId,
        member_id: config.memberId,
        tag: DECISION_AUDIT_TAG,
        severity: event.decision === 'allow' ? 'low' : 'medium',
        status: true,
        metadata: event,
      },
    });
    if (!env.ok) {
      console.error(
        `transcodes-guard: decision audit not recorded (status ${env.status})`,
      );
    }
  } catch (err) {
    console.error(
      `transcodes-guard: decision audit not recorded (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
}

/**
 * Config-less wrapper bound onto the GateBackend seam. The hook entrypoints
 * call this after emitting their decision; without a resolvable token (e.g.
 * the deny-no-token path, CI) it is a silent no-op.
 */
export async function sendGateDecisionAudit(
  decision: GateDecision,
): Promise<void> {
  const event = decisionAuditEventOf(decision);
  if (!event) return;
  let config: StepupConfig;
  try {
    config = loadStepupConfig();
  } catch {
    return;
  }
  await sendDecisionAudit(config, event);
}
