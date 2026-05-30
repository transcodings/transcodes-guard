/**
 * Side-effect-only module — see plugins/claude-code-ai-action-tracker/host.ts
 * for the rationale. Codex CLI has no equivalent of $CLAUDE_PLUGIN_DATA, so
 * dataDir() / cacheDir() will fall back to the legacy host-agnostic paths.
 */
process.env.AI_ACTION_TRACKER_HOST = "codex";
export {};
//# sourceMappingURL=host.js.map