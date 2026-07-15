/**
 * Public surface of @transcodes-guard/core/stepup.
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
export { CONSOLE_SESSION_COMMENT, fetchMemberProfile, openConsoleSession, } from './console.js';
export { evaluatePreToolUse, GATE_DECISION_KIND, } from './evaluate.js';
export { openBrowser } from './gate.js';
export { inspectStepupState, } from './inspector.js';
export { parseMemberAccessToken, REQUIRED_AUDIENCE, } from './jwt.js';
export { checkRbacPermission, } from './rbac-check.js';
export { createConsoleBrowserSession, createStepupSession, pollStepupByCoordinate, pollStepupSession, pollStepupSessionWait, } from './session.js';
export { clearTokenFile, readTokenFromFile, readTokenList, readTokenRecords, removeTokenFromFile, resolveToken, setActiveToken, setTokenLabel, transcodesConfigDir, transcodesConfigFile, writeTokenToFile, } from './token-store.js';
export { claimStepupVerified, hasStepupVerified, markStepupVerified, } from './verified-memory.js';
//# sourceMappingURL=index.js.map