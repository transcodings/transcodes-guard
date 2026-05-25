/**
 * Public surface of @ai-action-tracker/hook-adapters.
 *
 * Pick the adapter matching the host that invoked the hook. Each adapter
 * exposes the same `HookAdapter` interface, so plugins can swap hosts
 * without touching their gate logic.
 */
export { type HookAdapter, type PreToolUseInput, type UserPromptSubmitInput, type PreToolUseDecision, } from "./types.js";
export { claudeCodeAdapter } from "./claude-code.js";
export { codexAdapter } from "./codex.js";
