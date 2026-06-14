/**
 * Shared wire types for the step-up gate DI boundary.
 *
 * These mirror the structural shapes defined inside the private packages
 * (`@transcodes-guard-private/stepup-core`, `.../danger-rules`). TypeScript is
 * structural, so the private adapter (`@transcodes-guard-private/gate-backend`)
 * satisfies `GateBackend` by assigning the real functions directly — the
 * `transcodesGateBackend: GateBackend` annotation makes the compiler enforce
 * that these shapes stay in sync. If a private shape drifts, the adapter build
 * fails loudly.
 *
 * The public side (hooks + mcp-server-core) imports only these types, never the
 * private packages, so it type-checks and builds standalone.
 */
import type { RbacAction } from '@transcodes-guard/danger-patterns';

export type { RbacAction };

/** A parsed PreToolUse tool call (host-neutral). Mirrors evaluate.ts. */
export interface ToolCallInput {
  toolName: string;
  toolInput: unknown;
  cwd: string;
}

/** Resolved danger match + its RBAC step-up coordinate. Mirrors evaluate.ts. */
export interface BlockResult {
  reason: string;
  details?: string[];
  command: string;
  /** Id of the matched pattern/tool-rule. Feeds the decision audit (H2). */
  ruleId: string;
  stepupResource: string;
  stepupAction: RbacAction;
}

/** The `ok: false` half of stepup-core's gate.ts `RequestResult`. */
export type StepupFailure = {
  ok: false;
  reason: 'no-token' | 'create-failed' | 'error';
  detail?: string;
};

/** Pending step-up record on disk. Mirrors pending.ts `PendingState`. */
export interface PendingState {
  sid: string;
  command: string;
  reason: string;
  browserUrl: string;
  createdAt: number;
  expiresAt?: string;
  status: 'pending' | 'verified';
  fp?: string;
}

/** Verified step-up record on disk. Mirrors store.ts `VerifiedStepup`. */
export interface VerifiedStepup {
  sid: string;
  verifiedAt: number;
}

/** RBAC permission level: 0 deny, 1 allow, 2 allow+step-up. Mirrors rbac-check.ts. */
export type RbacLevel = 0 | 1 | 2;

/** Host-agnostic PreToolUse gate decision. Mirrors evaluate.ts `GateDecision`. */
export type GateDecision =
  | { kind: 'pass' }
  | {
      kind: 'allow';
      block: BlockResult;
      consumeHere: boolean;
      fp?: string;
    }
  | { kind: 'deny-no-token'; block: BlockResult }
  | {
      kind: 'deny-rbac-denied';
      block: BlockResult;
      resource: string;
      action: string;
    }
  | {
      kind: 'deny-stepup-failure';
      block: BlockResult;
      failure: StepupFailure;
    }
  | {
      kind: 'deny-stepup-pending';
      block: BlockResult;
      sid: string;
      browserUrl: string;
      browserLaunched: boolean;
      pending: PendingState;
    };

/** Backend HTTP envelope. Mirrors client.ts `Envelope`. */
export type Envelope = {
  ok: boolean;
  status: number;
  data: unknown;
};

/** Args for creating a step-up session. Mirrors session.ts `CreateStepupArgs`. */
export type CreateStepupArgs = {
  comment: string;
  action?: string;
  resource?: string;
  member_id?: string;
  mode?: string;
};

/** Mirrors session.ts `CreatedStepupSession`. */
export type CreatedStepupSession = {
  envelope: Envelope;
  sid?: string;
  browserUrl?: string;
  expiresAt?: string;
};

/** Mirrors session.ts `PollStepupResult`. */
export type PollStepupResult = {
  envelope: Envelope;
  status?: string;
};

/** Mirrors session.ts `WaitStepupResult`. */
export type WaitStepupResult = {
  envelope: Envelope;
  outcome: 'verified' | 'timeout';
  elapsedMs: number;
  attempts: number;
};

/**
 * Step-up state inspection snapshot. The server consumes only `verified.exists`,
 * `pending.exists`, and `pending.sid`; the full record carries more fields
 * (verified_fp, browser_lock, etc.) that are serialized verbatim. Keeping this
 * structurally loose lets the private inspector's richer shape assign cleanly.
 */
export interface InspectionRecord {
  exists: boolean;
  sid?: string;
}
export interface StepupStateInspection {
  verified: InspectionRecord;
  pending: InspectionRecord;
}

/** Tool-rule registry types. Mirror danger-rules tool-rules.ts (schema v2). */
export type GuardMatcher = 'exact' | 'glob';
export type GuardProvider = 'claude' | 'codex' | 'cursor' | 'antigravity';
export type ToolRuleSource = 'system' | 'bundle';
export interface ToolRule {
  id: string;
  type: 'mcp';
  label: string;
  description: string;
  name: string;
  matcher: GuardMatcher;
  /** Optional MCP host label — stored for future use; does not affect matching today. */
  provider?: GuardProvider;
  action?: RbacAction;
  resource?: string;
  /** Hook consumes FP-keyed verified record when true (default: bundle=true, system=false). */
  consume_in_hook?: boolean;
}
export interface MergedToolRule extends ToolRule {
  source: ToolRuleSource;
}
export interface ToolRuleMatch {
  matched: MergedToolRule;
}
export interface ToolRuleInput {
  id: string;
  type?: 'mcp';
  label: string;
  description: string;
  name: string;
  matcher?: GuardMatcher;
  provider?: GuardProvider;
  action?: string;
  resource?: string;
  status?: 'active' | 'inactive';
  metadata?: Record<string, unknown>;
}
export interface ToolRuleChanges {
  type?: 'mcp';
  label?: string;
  description?: string;
  name?: string;
  matcher?: GuardMatcher;
  provider?: GuardProvider;
  action?: string;
  resource?: string;
  status?: 'active' | 'inactive';
  metadata?: Record<string, unknown>;
}
