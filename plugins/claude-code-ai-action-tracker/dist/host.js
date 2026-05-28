/**
 * Side-effect-only module — claims this plugin's host identity for
 * @ai-action-tracker/plugin-paths. Every hook entry and transport entry
 * in this plugin must import this file BEFORE any module that calls
 * dataDir() / cacheDir() (in practice: before @ai-action-tracker/hook-adapters
 * and @ai-action-tracker/stepup-core / mcp-server-core).
 *
 * Why a separate file: hook-adapters' barrel re-exports all four adapters,
 * so setting AI_ACTION_TRACKER_HOST inside an adapter file causes
 * whichever loads last to overwrite. Doing it here, as the entry's first
 * static import, makes the source-order guarantee load-bearing.
 */
process.env.AI_ACTION_TRACKER_HOST = "claude-code";
export {};
//# sourceMappingURL=host.js.map