/**
 * Persistent token store — `~/.transcodes/config.json`.
 *
 * Distinct from store.ts / pending.ts (which live in the OS cache dir and
 * hold ephemeral step-up state). This file holds the long-lived member MCP
 * JWT that `loadStepupConfig()` sends as `x-transcodes-token`.
 *
 * Why a home-dir dotfile (not the cache dir): the token must survive cache
 * cleanup and be discoverable by both the MCP server AND the four hook
 * subprocesses, none of which inherit a GUI host's shell environment. The
 * CLI (`@bigstrider/transcodes-cli`) writes here; `resolveToken()` reads here.
 *
 * Token precedence (resolveToken):
 *   1. ~/.transcodes/config.json     — written by the CLI, the source of truth
 *   2. process.env.TRANSCODES_TOKEN  — fallback for config-less envs (CI, power users)
 *   3. null                          — caller fail-safes (hook → block)
 *
 * Rationale for config-first: a stray TRANSCODES_TOKEN left in the user's
 * shell used to silently shadow whatever `transcodes set` wrote, so config
 * edits appeared to have no effect (the hooks have no stdout to warn on). The
 * CLI-managed file now wins; env only fills in when no config token exists.
 *
 * File schema (multi-token, labelled):
 *   {
 *     "token": "<active token>",                 // the one resolveToken() returns
 *     "token_list": [                            // pool the user can switch between
 *       { "token": "<t1>", "label": "prod" },
 *       { "token": "<t2>" }
 *     ]
 *   }
 * The active `token` is always kept inside `token_list`. Legacy files are
 * upgraded in-memory: a `token`-only file becomes a one-item list, and a
 * `token_list` of bare strings is read as records with no label.
 *
 * Security: the directory is created 0700 and the file 0600 (best-effort;
 * POSIX mode bits are largely ignored on Windows, where the file still sits
 * under the user profile and is user-scoped by default). A real OS keychain
 * is tracked separately in docs/prd/0005-token-auth-device-flow.md.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR_NAME = '.transcodes';
const CONFIG_FILE_NAME = 'config.json';

/** `~/.transcodes` — same resolution on macOS/Linux/Windows via os.homedir(). */
export function transcodesConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

/** `~/.transcodes/config.json`. */
export function transcodesConfigFile(): string {
  return path.join(transcodesConfigDir(), CONFIG_FILE_NAME);
}

/** A saved token plus the optional user-facing label used to identify it. */
export type TokenRecord = {
  token: string;
  label: string | null;
};

type StoredConfig = {
  token: string | null;
  tokenList: TokenRecord[];
};

type RawConfig = {
  token?: unknown;
  token_list?: unknown;
};

/**
 * Read and parse the whole config object. Returns null when the file is
 * absent, unreadable, or not a JSON object. Never throws.
 */
function readRawConfig(): RawConfig | null {
  let raw: string;
  try {
    raw = readFileSync(transcodesConfigFile(), 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as RawConfig;
}

/** Persist the full config object (dir 0700, file 0600). Throws on I/O failure. */
function writeRawConfig(config: RawConfig): void {
  const dir = transcodesConfigDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(transcodesConfigFile(), JSON.stringify(config), {
    mode: 0o600,
  });
}

function normalizeToken(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Accept both the new `{ token, label }` records and legacy bare strings. */
function normalizeRecord(item: unknown): TokenRecord | null {
  if (typeof item === 'string') {
    const token = normalizeToken(item);
    return token ? { token, label: null } : null;
  }
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const obj = item as { token?: unknown; label?: unknown };
    const token = normalizeToken(obj.token);
    if (!token) return null;
    return { token, label: normalizeLabel(obj.label) };
  }
  return null;
}

/**
 * Read + normalize token fields. Never throws — a broken config file must
 * not brick the hook (fail-open before a danger match, fail-safe after — see
 * evaluate.ts). Returns `{ token: null, tokenList: [] }` on any problem.
 */
function readConfig(): StoredConfig {
  const obj = readRawConfig();
  if (!obj) {
    return { token: null, tokenList: [] };
  }

  const list: TokenRecord[] = [];
  const seen = new Set<string>();
  const push = (rec: TokenRecord | null) => {
    if (!rec) return;
    const existing = list.find((r) => r.token === rec.token);
    if (existing) {
      if (!existing.label && rec.label) existing.label = rec.label;
      return;
    }
    seen.add(rec.token);
    list.push(rec);
  };

  if (Array.isArray(obj.token_list)) {
    for (const item of obj.token_list) push(normalizeRecord(item));
  }
  const active = normalizeToken(obj.token);
  if (active) push({ token: active, label: null });

  return {
    token: active ?? (list.length > 0 ? list[0].token : null),
    tokenList: list,
  };
}

function writeConfig(config: StoredConfig): void {
  const token_list = config.tokenList.map((r) =>
    r.label ? { token: r.token, label: r.label } : { token: r.token },
  );
  writeRawConfig({
    ...(readRawConfig() ?? {}),
    token: config.token,
    token_list,
  });
}

/**
 * Read the active token from `~/.transcodes/config.json`. Returns null when
 * the file is absent, unreadable, malformed, or holds no non-empty token.
 * Backward-compatible signature used by `resolveToken()` and the hooks.
 */
export function readTokenFromFile(): string | null {
  return readConfig().token;
}

/** All saved tokens in the pool (active token included). Never throws. */
export function readTokenList(): string[] {
  return readConfig().tokenList.map((r) => r.token);
}

/** All saved token records (token + optional label). Never throws. */
export function readTokenRecords(): TokenRecord[] {
  return readConfig().tokenList;
}

/**
 * Persist `token` as the active token, adding it to the pool if new
 * (dir 0700, file 0600). Existing tokens in the pool are preserved.
 *
 * A `label` is **mandatory** when adding a new token — every saved token must
 * be identifiable. When re-activating a token already in the pool, the label
 * may be omitted (the stored label is kept) or supplied to rename it. Used by
 * the CLI, never by a hook. Throws on empty token, missing label for a new
 * token, or I/O failure.
 */
export function writeTokenToFile(token: string, label?: string): void {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('token is empty');
  }
  const nextLabel = normalizeLabel(label);
  const current = readConfig();
  const existing = current.tokenList.find((r) => r.token === trimmed);
  if (!existing && !nextLabel) {
    throw new Error('label is required');
  }
  const tokenList = existing
    ? current.tokenList.map((r) =>
        r.token === trimmed
          ? { token: trimmed, label: nextLabel ?? r.label }
          : r,
      )
    : [...current.tokenList, { token: trimmed, label: nextLabel }];
  writeConfig({ token: trimmed, tokenList });
}

/**
 * Switch the active token to one already in (or newly added to) the pool.
 * Throws on empty token / I/O failure.
 */
export function setActiveToken(token: string): void {
  writeTokenToFile(token);
}

/**
 * Rename the label of a token already in the pool, without changing which
 * token is active. Throws when the token is not found or the label is empty.
 */
export function setTokenLabel(token: string, label: string): void {
  const trimmed = token.trim();
  const nextLabel = normalizeLabel(label);
  if (!nextLabel) {
    throw new Error('label is required');
  }
  const current = readConfig();
  if (!current.tokenList.some((r) => r.token === trimmed)) {
    throw new Error('token not found');
  }
  const tokenList = current.tokenList.map((r) =>
    r.token === trimmed ? { token: r.token, label: nextLabel } : r,
  );
  writeConfig({ token: current.token, tokenList });
}

/**
 * Remove a token from the pool. If it was the active token, the first
 * remaining token becomes active (or none). Deletes the file entirely when
 * the pool becomes empty. Deletes the file entirely. Best-effort.
 */
export function removeTokenFromFile(token: string): void {
  const trimmed = token.trim();
  const current = readConfig();
  const tokenList = current.tokenList.filter((r) => r.token !== trimmed);
  if (tokenList.length === 0) {
    clearTokenFile();
    return;
  }
  const active =
    current.token && tokenList.some((r) => r.token === current.token)
      ? current.token
      : tokenList[0].token;
  writeConfig({ token: active, tokenList });
}

/**
 * Remove all saved tokens (CLI `reset`). Deletes the config file entirely.
 * Best-effort.
 */
export function clearTokenFile(): void {
  try {
    rmSync(transcodesConfigFile(), { force: true });
  } catch {
    // best-effort cleanup
  }
}

export type TokenSource = 'env' | 'file' | 'none';

export type ResolvedToken = {
  token: string | null;
  source: TokenSource;
};

/**
 * Resolve the active token following the documented precedence
 * (file → env → none). Returns the source too so callers (e.g. a CLI
 * `status` command) can show where the token came from.
 */
export function resolveToken(): ResolvedToken {
  const fileToken = readTokenFromFile();
  if (fileToken) {
    return { token: fileToken, source: 'file' };
  }
  const envToken = process.env.TRANSCODES_TOKEN?.trim();
  if (envToken) {
    return { token: envToken, source: 'env' };
  }
  return { token: null, source: 'none' };
}
