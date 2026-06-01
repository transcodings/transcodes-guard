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
export { evaluatePreToolUse, } from './evaluate.js';
export { requestStepup, } from './gate.js';
export { inspectStepupState, } from './inspector.js';
export { parseMemberAccessToken, REQUIRED_AUDIENCE, } from './jwt.js';
export { formatAllowReason, formatBlockedSummary, formatNoTokenReason, formatNoTokenSessionNotice, formatNoTokenSystemMessage, formatStderrTag, formatStepupFailureDetail, formatStepupFailureReason, formatStepupFailureSystemMessage, formatStepupPendingReason, formatStepupPendingSystemMessage, } from './messages.js';
export { clearPending, isExpired, markVerified, readPending, writePending, } from './pending.js';
export { createStepupSession, pollStepupSession, pollStepupSessionWait, } from './session.js';
export { cacheDir, consumeVerified, readVerified, writeVerified, } from './store.js';
export { clearTokenFile, isTrackerEnabled, readTokenFromFile, readTokenList, readTokenRecords, removeTokenFromFile, resolveToken, setActiveToken, setTokenLabel, setTrackerEnabled, transcodesConfigDir, transcodesConfigFile, writeTokenToFile, } from './token-store.js';
//# sourceMappingURL=index.js.map