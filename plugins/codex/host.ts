/**
 * Side-effect-only module — see plugins/claude-code/host.ts
 * for the rationale. Codex CLI has no equivalent of $CLAUDE_PLUGIN_DATA, so
 * dataDir() / cacheDir() will fall back to the legacy host-agnostic paths.
 */
process.env.TRANSCODES_GUARD_HOST = 'codex';
