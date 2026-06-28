/**
 * Public surface of @transcodes-guard/hook-adapters.
 *
 * Pick the adapter matching the host that invoked the hook. Each adapter
 * exposes the same `HookAdapter` interface, so plugins can swap hosts
 * without touching their gate logic.
 */

export {
  antigravityAdapter,
  COMPLETION_PATTERN,
  detectUserDoneFromTranscript,
} from './antigravity.js';

export { claudeCodeAdapter } from './claude-code.js';
export {
  codexAdapter,
  emitCodexPermissionRequest,
  parseCodexPermissionRequestStdin,
} from './codex.js';
export { cursorAdapter } from './cursor.js';
export type {
  HookAdapter,
  InjectStep,
  PermissionRequestDecision,
  PreInvocationInput,
  PreToolUseDecision,
  PreToolUseInput,
  UserPromptSubmitInput,
} from './types.js';
