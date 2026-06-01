/**
 * Side-effect-only module — claims this plugin's host identity for
 * @transcodes-guard/plugin-paths. Every hook entry and transport entry
 * in this plugin must import this file BEFORE any module that calls
 * dataDir() / cacheDir() (in practice: before @transcodes-guard/hook-adapters
 * and @transcodes-guard-private/stepup-core / mcp-server-core).
 *
 * Why a separate file: hook-adapters' barrel re-exports all four adapters,
 * so setting TRANSCODES_GUARD_HOST inside an adapter file causes
 * whichever loads last to overwrite. Doing it here, as the entry's first
 * static import, makes the source-order guarantee load-bearing.
 */
process.env.TRANSCODES_GUARD_HOST = "claude-code";
