export type HostName = "claude-code" | "codex" | "antigravity" | "cursor";
export declare function detectHost(): HostName | null;
export declare function legacyDataDir(): string;
/**
 * OS-appropriate cache directory.
 *
 *   linux   $XDG_CACHE_HOME or ~/.cache, suffix "ai-action-tracker"
 *   macOS   ~/Library/Caches/ai-action-tracker
 *   win32   %LOCALAPPDATA%\ai-action-tracker\Cache
 */
export declare function legacyCacheDir(): string;
/**
 * Persistent data directory. Use for files that should survive plugin
 * updates: user rules, step-up coordination state, etc.
 *
 *   claude-code + $CLAUDE_PLUGIN_DATA set → $CLAUDE_PLUGIN_DATA
 *   otherwise                              → legacyDataDir()
 */
export declare function dataDir(): string;
/**
 * Short-lived cache directory. Currently identical to dataDir() under
 * Claude Code (CLAUDE_PLUGIN_DATA covers both), and falls back to
 * legacyCacheDir() elsewhere. Kept as a separate function so a future
 * change can split them again without touching call sites.
 */
export declare function cacheDir(): string;
/**
 * One-shot migration of a single file from legacy to current path.
 *
 * Behaviour:
 *   - If new path file already exists → no-op (already migrated or fresh).
 *   - Else if legacy file exists → copy to new path, rename legacy to
 *     `<name>.bak` so a re-run is idempotent and the user has a recovery
 *     copy.
 *   - Else → no-op (nothing to migrate).
 *
 * Fails open: any IO error is swallowed. The caller will fall back to
 * reading the new path (which may be empty), matching the existing
 * fail-open policy of loadUserPatterns / readVerified / readPending.
 * Never breaks a hook.
 */
export declare function migrateLegacyFile(name: string, kind: "data" | "cache"): void;
