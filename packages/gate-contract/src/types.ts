/**
 * Shared wire types for the step-up gate DI boundary.
 *
 * These mirror the structural shapes defined inside the private packages
 * (`@transcodes-guard/stepup-core`, `.../danger-patterns`). TypeScript is
 * structural, so the private adapter (`@transcodes-guard/gate-backend`)
 * satisfies `GateBackend` by assigning the real functions directly — the
 * `transcodesGateBackend: GateBackend` annotation makes the compiler enforce
 * that these shapes stay in sync. If a private shape drifts, the adapter build
 * fails loudly.
 *
 * The public side (hooks + mcp-server-core) imports only these types, never the
 * private packages, so it type-checks and builds standalone.
 */
import type {
  MergedPattern,
  RbacAction,
} from '@transcodes-guard/danger-patterns';

export type { MergedPattern, RbacAction };

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

/**
 * Runtime + type-level kind constants for `GateDecision`. Source of truth
 * for the discriminated union below. Mirrored in `stepup-core/src/evaluate.ts`
 * (import firewall — the two copies must stay in lockstep; the `gate-backend`
 * drift alarm catches a missed sync).
 */
export const GATE_DECISION_KIND = {
  PROCEED_UNGATED: 'proceed-ungated',
  PROCEED_BY_POLICY: 'proceed-by-policy',
  PROCEED_BY_VERIFICATION: 'proceed-by-verification',
  BLOCK_NO_TOKEN: 'block-no-token',
  BLOCK_BY_POLICY: 'block-by-policy',
  BLOCK_STEPUP_CREATE_FAILED: 'block-stepup-create-failed',
  BLOCK_STEPUP_CHALLENGED: 'block-stepup-challenged',
} as const;

/** Host-agnostic PreToolUse gate decision. Mirrors evaluate.ts `GateDecision`. */
export type GateDecision =
  | { kind: typeof GATE_DECISION_KIND.PROCEED_UNGATED }
  | {
      kind: typeof GATE_DECISION_KIND.PROCEED_BY_POLICY;
      block: BlockResult;
      resource: string;
      action: string;
      /** Backend `/guard/evaluate` classification + matrix explanation. */
      reasoning?: string;
    }
  | {
      kind: typeof GATE_DECISION_KIND.PROCEED_BY_VERIFICATION;
      block: BlockResult;
      consumeHere: boolean;
      fp?: string;
    }
  | { kind: typeof GATE_DECISION_KIND.BLOCK_NO_TOKEN; block: BlockResult }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY;
      block: BlockResult;
      resource: string;
      action: string;
      reasoning?: string;
    }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
      block: BlockResult;
      failure: StepupFailure;
      reasoning?: string;
    }
  | {
      kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
      block: BlockResult;
      sid: string;
      browserUrl: string;
      browserLaunched: boolean;
      pending: PendingState;
      reasoning?: string;
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
};

/** Mirrors session.ts `CreatedStepupSession`. */
export type CreatedStepupSession = {
  envelope: Envelope;
  sid?: string;
  browserUrl?: string;
  expiresAt?: string;
  mode?: string;
};

/** Mirrors session.ts `PollStepupResult`. */
export type PollStepupResult = {
  envelope: Envelope;
  status?: string;
};

/** Mirrors session.ts `WaitStepupResult`. */
export type WaitStepupResult = {
  envelope: Envelope;
  outcome: 'verified' | 'rejected' | 'timeout';
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

/**
 * Outcome of a forced policy-bundle refresh. Mirrors stepup-core's
 * `PolicyBundleRefreshOutcome` plus `'skipped'` (no resolvable token):
 *  - `fresh` / `refreshed` — cache now holds the latest bundle.
 *  - `not-modified` — backend confirmed the cache is already current.
 *  - `failed` — fetch failed; the previous cache (last-known-good) is kept.
 *  - `skipped` — no token configured, nothing to refresh.
 */
export type PolicyBundleRefreshOutcome =
  | 'fresh'
  | 'refreshed'
  | 'not-modified'
  | 'failed'
  | 'skipped';

/** Tool-rule registry types. Mirror danger-patterns tool-rules.ts (schema v2). */
export type GuardMatcher = 'exact' | 'glob' | 'regex';
export type GuardProvider = 'claude' | 'codex' | 'cursor' | 'antigravity';
export type ToolRuleSource = 'system' | 'bundle';
export interface ToolRule {
  id: string;
  type: 'mcp' | 'bash';
  label: string;
  description: string;
  name: string;
  matcher: GuardMatcher;
  /** Optional MCP host label — scopes matching to that host (absent ⇒ every host). */
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
  type?: 'mcp' | 'bash';
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
  type?: 'mcp' | 'bash';
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
