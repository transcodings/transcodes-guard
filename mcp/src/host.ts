/**
 * Side-effect-only module — claims this package's host identity for
 * @transcodes-guard/plugin-paths. The standalone MCP server is its own host:
 * it has no $CLAUDE_PLUGIN_DATA, so dataDir() / cacheDir() fall back to the
 * legacy host-agnostic paths under ~/.transcodes/state/.
 *
 * Must be imported BEFORE any module that calls dataDir() / cacheDir() or
 * registers the backend (mcp-server-core / gate-contract). See
 * plugins/claude-code/host.ts for the full source-order rationale.
 */
process.env.TRANSCODES_GUARD_HOST = 'mcp';
