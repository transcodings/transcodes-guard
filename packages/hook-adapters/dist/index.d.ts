/**
 * Public surface of @transcodes-guard/hook-adapters.
 *
 * Pick the adapter matching the host that invoked the hook. Each adapter
 * exposes the same `HookAdapter` interface, so plugins can swap hosts
 * without touching their gate logic.
 */
export { ANTIGRAVITY_COMPLETION_PATTERN, antigravityAdapter, detectUserDoneFromTranscript, } from './antigravity.js';
export { claudeCodeAdapter } from './claude-code.js';
export { codexAdapter } from './codex.js';
export { cursorAdapter } from './cursor.js';
export type { HookAdapter, InjectStep, PreInvocationInput, PreToolUseDecision, PreToolUseInput, UserPromptSubmitInput, } from './types.js';
