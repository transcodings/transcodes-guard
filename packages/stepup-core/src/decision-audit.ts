/**
 * Gate decision audit — fire-and-forget visibility (Phase 3 v2 Unit H, H2).
 *
 * Every step-up MFA *outcome* — an action authorized by step-up
 * (`proceed-by-verification`), or a step-up session explicitly refused by the
 * backend (`block-stepup-create-failed` w/ `reason === 'create-failed'`) — is
 * reported to the backend's existing generic audit module
 * (`POST /v1/audit/logs`, src/audit/ in transcode-backend-nestjs-v1) under
 * the `guard_gate_decision` tag. Evasion-attempt visibility is the
 * compensating control for publishing the policy data (PRD §6).
 *
 * Step-up-irrelevant verdicts (gate uninvolved, policy-only allow/deny,
 * no-token, step-up challenged-but-unfinished) are NOT audited — they carry
 * no MFA forensic value and the audit log is the MFA compensating control.
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
import { GATE_DECISION_KIND, type GateDecision } from './evaluate.js';

export const DECISION_AUDIT_TAG = 'guard_gate_decision';
export const DECISION_AUDIT_TIMEOUT_MS = 1_000;

/** The two recorded decision kinds (the MFA outcomes). */
export type RecordedDecisionKind =
  | typeof GATE_DECISION_KIND.PROCEED_BY_VERIFICATION
  | typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;

export type DecisionAuditEvent = {
  decision: RecordedDecisionKind;
  resource: string;
  action: string;
  ruleId: string;
  /** Command fingerprint (16-hex) when the decision carries one. */
  fp?: string;
};

/**
 * Wire-translation map: the backend (`transcode-backend-nestjs-v1`,
 * `src/audit/`) knows only the *legacy* kind strings. We renamed the union
 * locally, but until the backend ships a matching enum we must send the
 * legacy values on the wire. This map is the single translation seam —
 * internal code uses the new kind constants, the wire payload uses the old.
 *
 * Only the two recorded kinds need a legacy mapping; every other kind is
 * filtered out by `decisionAuditEventOf` before it reaches the wire.
 */
const LEGACY_WIRE_DECISION: Record<RecordedDecisionKind, string> = {
  [GATE_DECISION_KIND.PROCEED_BY_VERIFICATION]: 'allow',
  [GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED]: 'deny-stepup-failure',
};

/** Legacy severity the backend expects: `allow` is low, everything else medium. */
function legacySeverity(decision: RecordedDecisionKind): 'low' | 'medium' {
  return decision === GATE_DECISION_KIND.PROCEED_BY_VERIFICATION
    ? 'low'
    : 'medium';
}

/**
 * Map a gate decision onto its audit event. Returns null for every
 * non-recorded kind (gate-uninvolved, policy-only allow/deny, no-token,
 * step-up challenged-but-unfinished) and for the `block-stepup-create-failed`
 * branches that are not a backend explicit refusal (`reason === 'no-token'`
 * or `'error'`). Only the two MFA-outcome events are recorded.
 */
export function decisionAuditEventOf(
  decision: GateDecision,
): DecisionAuditEvent | null {
  switch (decision.kind) {
    case GATE_DECISION_KIND.PROCEED_BY_VERIFICATION:
      return {
        decision: decision.kind,
        resource: decision.block.stepupResource,
        action: decision.block.stepupAction,
        ruleId: decision.block.ruleId,
        ...(decision.fp ? { fp: decision.fp } : {}),
      };
    case GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED:
      // Narrow: only the backend explicit refusal is audited. The `no-token`
      // race (semantically `block-no-token`) and the `error` (local config
      // load failure, not a backend refusal) are excluded.
      if (decision.failure.reason !== 'create-failed') return null;
      return {
        decision: decision.kind,
        resource: decision.block.stepupResource,
        action: decision.block.stepupAction,
        ruleId: decision.block.ruleId,
      };
    default:
      return null;
  }
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
        severity: legacySeverity(event.decision),
        status: true,
        // Wire-translation seam: send the legacy kind string the backend
        // knows, not the renamed local kind. See LEGACY_WIRE_DECISION.
        metadata: { ...event, decision: LEGACY_WIRE_DECISION[event.decision] },
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
