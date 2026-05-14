/**
 * Cross-platform verified-stepup state file.
 *
 * Uses env-paths to pick OS-appropriate cache directories:
 *   linux   ~/.cache/ai-action-tracker/
 *   macOS   ~/Library/Caches/ai-action-tracker/
 *   win32   %LOCALAPPDATA%\ai-action-tracker\Cache\
 *
 * Single-shot policy: every danger command requires a fresh MFA. The hook
 * writes a record on verify, the consumer (the hook itself, immediately
 * after) deletes it. TTL (`STEPUP_TTL_MS`) is enforced on read as a
 * defence against stale files left behind by abnormal exits.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { STEPUP_TTL_MS } from "./config.js";

/**
 * OS-appropriate cache directory. Inlined instead of pulling env-paths
 * because the plugin distribution ships dist/ without node_modules.
 *
 *   linux   $XDG_CACHE_HOME or ~/.cache, suffix "ai-action-tracker"
 *   macOS   ~/Library/Caches/ai-action-tracker
 *   win32   %LOCALAPPDATA%\ai-action-tracker\Cache
 */
function cacheDir(): string {
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

export type VerifiedStepup = {
  sid: string;
  verifiedAt: number;
};

const FILE_NAME = "stepup-verified.json";

function storePath(): string {
  return path.join(cacheDir(), FILE_NAME);
}

export function readVerified(): VerifiedStepup | null {
  const file = storePath();
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    consumeVerified();
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    consumeVerified();
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const sid = typeof obj.sid === "string" ? obj.sid : null;
  const verifiedAt = typeof obj.verifiedAt === "number" ? obj.verifiedAt : null;
  if (!sid || verifiedAt === null) {
    consumeVerified();
    return null;
  }
  if (Date.now() - verifiedAt > STEPUP_TTL_MS) {
    consumeVerified();
    return null;
  }
  return { sid, verifiedAt };
}

export function writeVerified(v: VerifiedStepup): void {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
}

export function consumeVerified(): void {
  try {
    rmSync(storePath(), { force: true });
  } catch {
    // best-effort cleanup
  }
}
