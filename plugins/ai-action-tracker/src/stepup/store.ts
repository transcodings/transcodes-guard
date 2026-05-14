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
import path from "node:path";
import envPaths from "env-paths";
import { STEPUP_TTL_MS } from "./config.js";

export type VerifiedStepup = {
  sid: string;
  verifiedAt: number;
};

const FILE_NAME = "stepup-verified.json";

function storePath(): string {
  const paths = envPaths("ai-action-tracker", { suffix: "" });
  return path.join(paths.cache, FILE_NAME);
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
