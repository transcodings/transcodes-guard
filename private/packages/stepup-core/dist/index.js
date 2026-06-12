/**
 * Public surface of @transcodes-guard-private/stepup-core.
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
export { request, } from './client.js';
export { DEFAULT_BACKEND_URL, loadStepupConfig, STEPUP_TTL_MS, } from './config.js';
export { DECISION_AUDIT_TAG, DECISION_AUDIT_TIMEOUT_MS, decisionAuditEventOf, sendDecisionAudit, sendGateDecisionAudit, } from './decision-audit.js';
export { evaluatePreToolUse, } from './evaluate.js';
export { fingerprintOf, requestStepup, } from './gate.js';
export { addToolRule, removeToolRule, updateToolRule } from './guard-rules.js';
export { inspectStepupState, } from './inspector.js';
export { parseMemberAccessToken, REQUIRED_AUDIENCE, } from './jwt.js';
export { clearPending, findPendingBySid, firstActivePending, firstInFlightFpPending, isExpired, listFpPendings, markVerified, readPending, sweepStepup, writePending, } from './pending.js';
export { fetchPolicyBundle, loadEffectiveToolRules, POLICY_BUNDLE_FETCH_TIMEOUT_MS, POLICY_BUNDLE_TTL_MS, PolicyBundleError, policyBundleCachePath, policyBundleSha384, readCachedPolicyBundle, refreshPolicyBundle, refreshPolicyBundleIfConfigured, verifyAndParsePolicyBundle, writeCachedPolicyBundle, } from './policy-bundle.js';
export { checkRbacPermission } from './rbac-check.js';
export { createStepupSession, pollStepupSession, pollStepupSessionWait, } from './session.js';
export { cacheDir, consumeVerified, listVerifiedFingerprints, readVerified, writeVerified, } from './store.js';
export { clearTokenFile, readTokenFromFile, readTokenList, readTokenRecords, removeTokenFromFile, resolveToken, setActiveToken, setTokenLabel, transcodesConfigDir, transcodesConfigFile, writeTokenToFile, } from './token-store.js';
//# sourceMappingURL=index.js.map