/**
 * Local data + cache directory resolution.
 *
 * All plugin-managed local state lives under the Transcodes product home
 * `~/.transcodes/` — the same root the CLI (`@bigstrider/transcodes-cli`)
 * already uses for `config.json` (token + enable flag). Plugin state goes one
 * level down in `~/.transcodes/state/` so the CLI's config and the plugins'
 * runtime state never mingle in the same listing, while a user still has a
 * single folder to inspect or wipe.
 *
 * This path is host-independent on purpose: Claude Code, Codex, Antigravity,
 * and Cursor all resolve to the same `~/.transcodes/state/`. (Previously
 * Claude Code isolated state under `$CLAUDE_PLUGIN_DATA` and the other hosts
 * used `~/.claude/ai-action-tracker/` + an OS cache dir; those locations are
 * now migration sources only — see `migrateLegacyFile`.)
 *
 * `detectHost()` is still exported for callers that need the host identity
 * (e.g. session-start primers); it no longer affects path resolution.
 */
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type HostName = 'claude' | 'codex' | 'antigravity' | 'cursor';

const HOST_ENV_VAR = 'TRANSCODES_GUARD_HOST';
const CLAUDE_PLUGIN_DATA_ENV = 'CLAUDE_PLUGIN_DATA';

export function detectHost(): HostName | null {
  const raw = process.env[HOST_ENV_VAR]?.trim();
  switch (raw) {
    case 'claude':
    case 'codex':
    case 'antigravity':
    case 'cursor':
      return raw;
    default:
      return null;
  }
}

/** Transcodes product home (`~/.transcodes`) — shared with the CLI's config.json. */
export function transcodesDir(): string {
  return path.join(os.homedir(), '.transcodes');
}

/** Where all plugin-managed local state lives (`~/.transcodes/state`). */
function stateDir(): string {
  return path.join(transcodesDir(), 'state');
}

/**
 * Legacy persistent-data location (`~/.claude/ai-action-tracker`). Retained
 * only as a migration source for users who ran a pre-consolidation build.
 */
export function legacyDataDir(): string {
  return path.join(os.homedir(), '.claude', 'transcodes-guard');
}

/**
 * Legacy OS cache location. Retained only as a migration source.
 *
 *   linux   $XDG_CACHE_HOME or ~/.cache, suffix "transcodes-guard"
 *   macOS   ~/Library/Caches/ai-action-tracker
 *   win32   %LOCALAPPDATA%\ai-action-tracker\Cache
 */
export function legacyCacheDir(): string {
  if (process.platform === 'win32') {
    const base =
      process.env.LOCALAPPDATA?.trim() ||
      path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'transcodes-guard', 'Cache');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'transcodes-guard');
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.cache');
  return path.join(base, 'transcodes-guard');
}

/**
 * Persistent data directory. Use for files that should survive plugin
 * updates: user rules, etc. Resolves to `~/.transcodes/state`.
 */
export function dataDir(): string {
  return stateDir();
}

/**
 * Short-lived cache directory. Identical to {@link dataDir} now that all state
 * lives under `~/.transcodes/state`. Kept as a separate function so a future
 * change can split them again without touching call sites.
 */
export function cacheDir(): string {
  return stateDir();
}

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
export function migrateLegacyFile(name: string, kind: 'data' | 'cache'): void {
  void kind;
  try {
    const target = stateDir();
    const newPath = path.join(target, name);
    if (existsSync(newPath)) {
      return;
    }

    const candidates: string[] = [];
    const plug = process.env[CLAUDE_PLUGIN_DATA_ENV]?.trim();
    if (plug && plug.length > 0) {
      candidates.push(path.join(plug, name));
    }
    candidates.push(path.join(legacyDataDir(), name));
    candidates.push(path.join(legacyCacheDir(), name));

    const oldPath = candidates.find((p) => p !== newPath && existsSync(p));
    if (!oldPath) {
      return;
    }

    mkdirSync(target, { recursive: true });
    copyFileSync(oldPath, newPath);
    renameSync(oldPath, `${oldPath}.bak`);
  } catch {
    // Fail open. Caller treats missing/unreadable file as empty state.
  }
}
