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
 * CLI (`@bigstrider/transcodes-cli login`) writes here; `resolveToken()`
 * reads here.
 *
 * Token precedence (resolveToken):
 *   1. process.env.TRANSCODES_TOKEN  — explicit override (CI, power users)
 *   2. ~/.transcodes/config.json     — written by the CLI
 *   3. null                          — caller fail-safes (hook → block)
 *
 * Security: the directory is created 0700 and the file 0600 (best-effort;
 * POSIX mode bits are largely ignored on Windows, where the file still sits
 * under the user profile and is user-scoped by default). A real OS keychain
 * is tracked separately in docs/prd/0005-token-auth-device-flow.md.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR_NAME = ".transcodes";
const CONFIG_FILE_NAME = "config.json";

/** `~/.transcodes` — same resolution on macOS/Linux/Windows via os.homedir(). */
export function transcodesConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

/** `~/.transcodes/config.json`. */
export function transcodesConfigFile(): string {
  return path.join(transcodesConfigDir(), CONFIG_FILE_NAME);
}

type StoredConfig = {
  token?: unknown;
};

/**
 * Read the token from `~/.transcodes/config.json`. Returns null when the
 * file is absent, unreadable, malformed, or holds no non-empty token. Never
 * throws — a broken config file must not brick the hook (fail-open before a
 * danger match, fail-safe after — see evaluate.ts).
 */
export function readTokenFromFile(): string | null {
  let raw: string;
  try {
    raw = readFileSync(transcodesConfigFile(), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const token = (parsed as StoredConfig).token;
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Persist the token to `~/.transcodes/config.json` (dir 0700, file 0600).
 * Used by the CLI, never by a hook. Throws on I/O failure so the CLI can
 * report the problem to the user.
 */
export function writeTokenToFile(token: string): void {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("token is empty");
  }
  const dir = transcodesConfigDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(transcodesConfigFile(), JSON.stringify({ token: trimmed }), {
    mode: 0o600,
  });
}

/** Delete `~/.transcodes/config.json` (CLI `logout`). Best-effort. */
export function clearTokenFile(): void {
  try {
    rmSync(transcodesConfigFile(), { force: true });
  } catch {
    // best-effort cleanup
  }
}

export type TokenSource = "env" | "file" | "none";

export type ResolvedToken = {
  token: string | null;
  source: TokenSource;
};

/**
 * Resolve the active token following the documented precedence
 * (env → file → none). Returns the source too so callers (e.g. a CLI
 * `status` command) can show where the token came from.
 */
export function resolveToken(): ResolvedToken {
  const envToken = process.env.TRANSCODES_TOKEN?.trim();
  if (envToken) {
    return { token: envToken, source: "env" };
  }
  const fileToken = readTokenFromFile();
  if (fileToken) {
    return { token: fileToken, source: "file" };
  }
  return { token: null, source: "none" };
}
