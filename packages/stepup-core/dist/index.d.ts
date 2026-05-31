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
export { requestStepup, type RequestInput, type RequestResult, } from "./gate.js";
export { createStepupSession, pollStepupSession, pollStepupSessionWait, type CreateStepupArgs, type CreatedStepupSession, type PollStepupResult, type WaitStepupResult, } from "./session.js";
export { readVerified, writeVerified, consumeVerified, cacheDir, type VerifiedStepup, } from "./store.js";
export { readPending, writePending, clearPending, markVerified, isExpired, type PendingState, } from "./pending.js";
export { request, type Envelope, type RequestInput as HttpRequestInput, } from "./client.js";
export { loadStepupConfig, type StepupConfig, DEFAULT_BACKEND_URL, STEPUP_TTL_MS, } from "./config.js";
export { resolveToken, readTokenFromFile, readTokenList, readTokenRecords, writeTokenToFile, setActiveToken, setTokenLabel, removeTokenFromFile, clearTokenFile, isTrackerEnabled, setTrackerEnabled, transcodesConfigDir, transcodesConfigFile, type TokenSource, type ResolvedToken, type TokenRecord, } from "./token-store.js";
export { parseMemberAccessToken, REQUIRED_AUDIENCE, type MemberTokenClaims, type ParsedMemberToken, } from "./jwt.js";
export { inspectStepupState, type VerifiedInspection, type PendingInspection, type BrowserLockInspection, type StepupStateInspection, } from "./inspector.js";
export { evaluatePreToolUse, type BlockResult, type GateDecision, type ToolCallInput, } from "./evaluate.js";
export { formatBlockedSummary, formatNoTokenSessionNotice, formatAllowReason, formatNoTokenReason, formatNoTokenSystemMessage, formatStepupFailureDetail, formatStepupFailureReason, formatStepupFailureSystemMessage, formatStepupPendingReason, formatStepupPendingSystemMessage, formatStderrTag, } from "./messages.js";
