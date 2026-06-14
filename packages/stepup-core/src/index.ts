/**
 * Public surface of @transcodes-guard/stepup-core.
 *
 * Host-agnostic step-up MFA primitives consumed by every plugin (Claude
 * Code, Codex CLI, ...). Adding a new host means writing a thin hook
 * adapter — never re-implementing any of these primitives.
 *
 * Note on the `HttpRequestInput` alias: `client.ts` and `gate.ts` both
 * happen to export a type called `RequestInput`. We rename the HTTP one
 * here so consumers can `import { RequestInput, HttpRequestInput }`
 * without collision.
 */

export {
  type Envelope,
  type RequestInput as HttpRequestInput,
  request,
} from './client.js';
export {
  DEFAULT_BACKEND_URL,
  loadStepupConfig,
  STEPUP_TTL_MS,
  type StepupConfig,
} from './config.js';
export {
  DECISION_AUDIT_TAG,
  DECISION_AUDIT_TIMEOUT_MS,
  type DecisionAuditEvent,
  decisionAuditEventOf,
  sendDecisionAudit,
  sendGateDecisionAudit,
} from './decision-audit.js';
export {
  type BlockResult,
  evaluatePreToolUse,
  type GateDecision,
  type ToolCallInput,
} from './evaluate.js';
export {
  fingerprintOf,
  type RequestInput,
  type RequestResult,
  requestStepup,
} from './gate.js';
export { addToolRule, removeToolRule, updateToolRule } from './guard-rules.js';
export {
  type BrowserLockInspection,
  inspectStepupState,
  type PendingInspection,
  type StepupStateInspection,
  type VerifiedInspection,
} from './inspector.js';
export {
  type MemberTokenClaims,
  type ParsedMemberToken,
  parseMemberAccessToken,
  REQUIRED_AUDIENCE,
} from './jwt.js';
export {
  clearPending,
  findPendingBySid,
  firstActivePending,
  firstInFlightFpPending,
  isExpired,
  listFpPendings,
  markVerified,
  type PendingState,
  readPending,
  sweepStepup,
  writePending,
} from './pending.js';
export {
  type CachedPolicyBundle,
  type FetchPolicyBundleResult,
  fetchPolicyBundle,
  GUARD_POLICY_BUNDLE_SCHEMA_VERSION,
  loadEffectiveToolRules,
  POLICY_BUNDLE_FETCH_TIMEOUT_MS,
  POLICY_BUNDLE_TTL_MS,
  type PolicyBundle,
  PolicyBundleError,
  type PolicyBundleRefreshOutcome,
  type PolicyBundleRule,
  policyBundleCachePath,
  policyBundleSha384,
  readCachedPolicyBundle,
  refreshPolicyBundle,
  refreshPolicyBundleIfConfigured,
  verifyAndParsePolicyBundle,
  writeCachedPolicyBundle,
} from './policy-bundle.js';
export { checkRbacPermission, type RbacLevel } from './rbac-check.js';
export {
  type CreatedStepupSession,
  type CreateStepupArgs,
  createStepupSession,
  type PollStepupResult,
  pollStepupSession,
  pollStepupSessionWait,
  type WaitStepupResult,
} from './session.js';
export {
  cacheDir,
  consumeVerified,
  listVerifiedFingerprints,
  readVerified,
  type VerifiedStepup,
  writeVerified,
} from './store.js';
export {
  clearTokenFile,
  type ResolvedToken,
  readTokenFromFile,
  readTokenList,
  readTokenRecords,
  removeTokenFromFile,
  resolveToken,
  setActiveToken,
  setTokenLabel,
  type TokenRecord,
  type TokenSource,
  transcodesConfigDir,
  transcodesConfigFile,
  writeTokenToFile,
} from './token-store.js';
