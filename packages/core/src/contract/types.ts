/**
 * Shared wire types for the step-up gate DI boundary.
 *
 * contract is a RE-EXPORT surface: the wire types are owned by the domains
 * (`../stepup/`, `../patterns/`) and re-exported here, so consumers keep the
 * stable `@transcodes-guard/core/contract` import spec while sharing the
 * domains' single declarations — including the RUNTIME `GATE_DECISION_KIND`
 * object, so hook `switch`es and `evaluate.ts` branch on the same constant.
 *
 * The hand-mirrored declarations (and the gate-backend "drift alarm" framing)
 * were retired once the #175 consolidation put source and mirror in the same
 * package; the `transcodesGateBackend: GateBackend` annotation in
 * `gate-backend/src/index.ts` remains as an ordinary implements-the-contract
 * type check. Only contract-only types (no domain original) are declared
 * directly in this file.
 */

export type {
  GuardMatcher,
  GuardProvider,
  MergedPattern,
  MergedToolRule,
  RbacAction,
  ToolRule,
  ToolRuleChanges,
  ToolRuleInput,
  ToolRuleMatch,
  ToolRuleSource,
} from '../patterns/index.js';
export {
  type BlockResult,
  type CreatedStepupSession,
  type CreateStepupArgs,
  type Envelope,
  GATE_DECISION_KIND,
  type GateDecision,
  type LatchInspection,
  type PollStepupResult,
  type RbacLevel,
  type StepupFailure,
  type StepupStateInspection,
  type ToolCallInput,
  type WaitStepupResult,
} from '../stepup/index.js';

/**
 * Outcome of a forced policy-bundle refresh. Contract-only type: the domain
 * has no single original — this is the union of core/stepup's refresh result
 * plus `'skipped'` (no resolvable token):
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
