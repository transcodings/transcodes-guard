export type HostName = "claude-code" | "codex" | "antigravity" | "cursor";
export declare function detectHost(): HostName | null;
/** Transcodes product home (`~/.transcodes`) — shared with the CLI's config.json. */
export declare function transcodesDir(): string;
/**
 * Legacy persistent-data location (`~/.claude/ai-action-tracker`). Retained
 * only as a migration source for users who ran a pre-consolidation build.
 */
export declare function legacyDataDir(): string;
/**
 * Legacy OS cache location. Retained only as a migration source.
 *
 *   linux   $XDG_CACHE_HOME or ~/.cache, suffix "transcodes-guard"
 *   macOS   ~/Library/Caches/ai-action-tracker
 *   win32   %LOCALAPPDATA%\ai-action-tracker\Cache
 */
export declare function legacyCacheDir(): string;
/**
 * Persistent data directory. Use for files that should survive plugin
 * updates: user rules, etc. Resolves to `~/.transcodes/state`.
 */
export declare function dataDir(): string;
/**
 * Short-lived cache directory. Identical to {@link dataDir} now that all state
 * lives under `~/.transcodes/state`. Kept as a separate function so a future
 * change can split them again without touching call sites.
 */
export declare function cacheDir(): string;
/**
 * One-shot migration of a single file from any historical location into
 * `~/.transcodes/state/`.
 *
 * Behaviour:
 *   - If the new path already exists → no-op (already migrated or fresh).
 *   - Else scan every historical location for `name` and migrate the first
 *     one found: copy to the new path, rename the source to `<name>.bak` so
 *     a re-run is idempotent and the user keeps a recovery copy.
 *   - Else → no-op (nothing to migrate).
 *
 * Historical locations scanned (a user may have run any host before):
 *   1. `$CLAUDE_PLUGIN_DATA/<name>`  — Claude Code stored both data and cache here
 *   2. `legacyDataDir()/<name>`       — Codex/Antigravity/Cursor user-rule files
 *   3. `legacyCacheDir()/<name>`      — Codex/Antigravity/Cursor step-up state
 *
 * `kind` is accepted for call-site compatibility but no longer affects the
 * target (data and cache both consolidate into `~/.transcodes/state`).
 *
 * Fails open: any IO error is swallowed. The caller falls back to reading the
 * new path (which may be empty), matching the fail-open policy of
 * loadUserPatterns / readVerified / readPending. Never breaks a hook.
 */
export declare function migrateLegacyFile(name: string, kind: "data" | "cache"): void;
