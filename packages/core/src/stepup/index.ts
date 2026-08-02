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
  CONSOLE_SESSION_COMMENT,
  type ConsoleSessionResult,
  fetchMemberProfile,
  type MemberProfileSummary,
  openConsoleSession,
} from './console.js';
export {
  type BlockResult,
  evaluatePreToolUse,
  GATE_DECISION_KIND,
  type GateDecision,
  type StepupFailure,
  type ToolCallInput,
} from './evaluate.js';
export { openBrowser } from './gate.js';
export {
  inspectStepupState,
  type StepupStateInspection,
} from './inspector.js';
export {
  type MemberTokenClaims,
  type ParsedMemberToken,
  parseMemberAccessToken,
  REQUIRED_AUDIENCE,
} from './jwt.js';
export {
  extractFailureMessage,
  type GuardStepUpStatus,
  type GuardVerdict,
  type RbacLevel,
} from './rbac-check.js';
export {
  type CreateConsoleSessionArgs,
  type CreatedStepupSession,
  type CreateStepupArgs,
  createConsoleBrowserSession,
  createStepupSession,
  type PollStepupResult,
  pollStepupByCoordinate,
  pollStepupSession,
  pollStepupSessionWait,
  type WaitStepupResult,
  type WaitStepupTarget,
} from './session.js';
export {
  clearTokenFile,
  isGuardEnabled,
  type ResolvedToken,
  readTokenFromFile,
  readTokenList,
  readTokenRecords,
  removeTokenFromFile,
  resolveToken,
  setActiveToken,
  setGuardEnabled,
  setTokenLabel,
  type TokenRecord,
  type TokenSource,
  transcodesConfigDir,
  transcodesConfigFile,
  writeTokenToFile,
} from './token-store.js';
