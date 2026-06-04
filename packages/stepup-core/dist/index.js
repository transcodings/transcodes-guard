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
export { requestStepup, fingerprintOf, } from "./gate.js";
export { createStepupSession, pollStepupSession, pollStepupSessionWait, } from "./session.js";
export { readVerified, writeVerified, consumeVerified, listVerifiedFingerprints, cacheDir, } from "./store.js";
export { readPending, writePending, clearPending, markVerified, isExpired, findPendingBySid, listFpPendings, firstInFlightFpPending, firstActivePending, sweepStepup, } from "./pending.js";
export { request, } from "./client.js";
export { checkRbacPermission } from "./rbac-check.js";
export { loadStepupConfig, DEFAULT_BACKEND_URL, STEPUP_TTL_MS, } from "./config.js";
export { resolveToken, readTokenFromFile, readTokenList, readTokenRecords, writeTokenToFile, setActiveToken, setTokenLabel, removeTokenFromFile, clearTokenFile, transcodesConfigDir, transcodesConfigFile, } from "./token-store.js";
export { parseMemberAccessToken, REQUIRED_AUDIENCE, } from "./jwt.js";
export { inspectStepupState, } from "./inspector.js";
export { evaluatePreToolUse, } from "./evaluate.js";
export { formatBlockedSummary, formatNoTokenSessionNotice, formatAllowReason, formatNoTokenReason, formatNoTokenSystemMessage, formatRbacDeniedReason, formatRbacDeniedSystemMessage, formatStepupFailureDetail, formatStepupFailureReason, formatStepupFailureSystemMessage, formatStepupPendingReason, formatStepupPendingSystemMessage, formatStderrTag, } from "./messages.js";
//# sourceMappingURL=index.js.map