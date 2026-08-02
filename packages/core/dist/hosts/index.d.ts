/**
 * Public surface of @transcodes-guard/core/hosts.
 *
 * Pick the adapter matching the host that invoked the hook. Each adapter
 * exposes the same `HookAdapter` interface, so plugins can swap hosts
 * without touching their gate logic.
 */
export { antigravityAdapter, COMPLETION_PATTERN, detectUserDoneFromTranscript, } from './antigravity.js';
export { claudeCodeAdapter } from './claude-code.js';
export { codexAdapter } from './codex.js';
export { cursorAdapter } from './cursor.js';
export { capturePrompt, type PromptContextResult, resolvePromptContext, } from './prompt-cache.js';
export { latestUserPromptFromTranscript, summarizePrompt, summarizePromptWithTitle, summarizeTasks, tailJsonlLines, } from './transcript.js';
export type { HookAdapter, InjectStep, PreInvocationInput, PreToolUseDecision, PreToolUseInput, UserPromptSubmitInput, } from './types.js';
