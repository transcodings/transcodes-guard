/**
 * Host-aware persistent + cache directory resolution.
 *
 * The plugin runs under one of four hosts: Claude Code, Codex CLI, Google
 * Antigravity, or Cursor IDE. Only Claude Code provides a standard plugin
 * data directory via the `CLAUDE_PLUGIN_DATA` environment variable
 * (`~/.claude/plugins/data/{id}/`, survives plugin updates). The other three
 * hosts have no equivalent, so they keep using the legacy host-agnostic
 * paths under the user's home directory.
 *
 * Host identification is an internal contract: each plugin's transport
 * entry and each hook adapter sets `AI_ACTION_TRACKER_HOST` to one of
 * the HostName values before any code that resolves a path runs. If the
 * env var is missing (e.g. running tsx directly without setting it,
 * Inspector dev session), `dataDir()` falls back to the legacy path —
 * never to `CLAUDE_PLUGIN_DATA`, even when set, to prevent accidental
 * cross-host data bleed when a user starts a non-claude-code host from
 * a shell that happens to have `CLAUDE_PLUGIN_DATA` exported.
 */
import { existsSync, mkdirSync, renameSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type HostName = "claude-code" | "codex" | "antigravity" | "cursor";

const HOST_ENV_VAR = "AI_ACTION_TRACKER_HOST";
const CLAUDE_PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

export function detectHost(): HostName | null {
  const raw = process.env[HOST_ENV_VAR]?.trim();
  switch (raw) {
    case "claude-code":
    case "codex":
    case "antigravity":
    case "cursor":
      return raw;
    default:
      return null;
  }
}

export function legacyDataDir(): string {
  return path.join(os.homedir(), ".claude", "ai-action-tracker");
}

/**
 * OS-appropriate cache directory.
 *
 *   linux   $XDG_CACHE_HOME or ~/.cache, suffix "ai-action-tracker"
 *   macOS   ~/Library/Caches/ai-action-tracker
 *   win32   %LOCALAPPDATA%\ai-action-tracker\Cache
 */
export function legacyCacheDir(): string {
  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA?.trim() ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "ai-action-tracker", "Cache");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "ai-action-tracker");
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".cache");
  return path.join(base, "ai-action-tracker");
}

/**
 * Persistent data directory. Use for files that should survive plugin
 * updates: user rules, step-up coordination state, etc.
 *
 *   claude-code + $CLAUDE_PLUGIN_DATA set → $CLAUDE_PLUGIN_DATA
 *   otherwise                              → legacyDataDir()
 */
export function dataDir(): string {
  if (detectHost() === "claude-code") {
    const plug = process.env[CLAUDE_PLUGIN_DATA_ENV]?.trim();
    if (plug && plug.length > 0) {
      return plug;
    }
  }
  return legacyDataDir();
}

/**
 * Short-lived cache directory. Currently identical to dataDir() under
 * Claude Code (CLAUDE_PLUGIN_DATA covers both), and falls back to
 * legacyCacheDir() elsewhere. Kept as a separate function so a future
 * change can split them again without touching call sites.
 */
export function cacheDir(): string {
  if (detectHost() === "claude-code") {
    const plug = process.env[CLAUDE_PLUGIN_DATA_ENV]?.trim();
    if (plug && plug.length > 0) {
      return plug;
    }
  }
  return legacyCacheDir();
}

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
export function migrateLegacyFile(
  name: string,
  kind: "data" | "cache",
): void {
  try {
    const currentDir = kind === "data" ? dataDir() : cacheDir();
    const legacyBase = kind === "data" ? legacyDataDir() : legacyCacheDir();

    if (currentDir === legacyBase) {
      return;
    }

    const newPath = path.join(currentDir, name);
    if (existsSync(newPath)) {
      return;
    }

    const oldPath = path.join(legacyBase, name);
    if (!existsSync(oldPath)) {
      return;
    }

    mkdirSync(currentDir, { recursive: true });
    copyFileSync(oldPath, newPath);
    renameSync(oldPath, oldPath + ".bak");
  } catch {
    // Fail open. Caller treats missing/unreadable file as empty state.
  }
}
