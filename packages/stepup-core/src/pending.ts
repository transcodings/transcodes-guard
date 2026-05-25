/**
 * Shared step-up state file — the synchronisation clock between
 * PreToolUse, SessionStart, UserPromptSubmit, Stop hooks and the
 * poll_stepup_session MCP tool. Hooks cannot talk to each other or
 * to the MCP server directly; this file is the only synchronous
 * channel they share.
 *
 * Distinct from store.ts: that file is a single-shot "verified"
 * record consumed by PreToolUse's fast path. This one tracks the
 * pending session itself (sid, browserUrl, command, expiry) so the
 * secondary hooks can surface status to the agent without re-hitting
 * the backend.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { STEPUP_TTL_MS } from "./config.js";
import { cacheDir } from "./store.js";

const FILE_NAME = "stepup-pending.json";

const PendingStateSchema = z.object({
  sid: z.string().min(1),
  command: z.string(),
  reason: z.string(),
  browserUrl: z.string(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.string().optional(),
  status: z.enum(["pending", "verified"]),
});

export type PendingState = z.infer<typeof PendingStateSchema>;

function pendingPath(): string {
  return path.join(cacheDir(), FILE_NAME);
}

export function readPending(): PendingState | null {
  try {
    const raw = readFileSync(pendingPath(), "utf8");
    const parsed = PendingStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writePending(state: PendingState): void {
  const file = pendingPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
}

export function clearPending(): void {
  try {
    rmSync(pendingPath(), { force: true });
  } catch {
    // best-effort cleanup
  }
}

export function markVerified(sid: string): void {
  const prev = readPending();
  if (!prev || prev.sid !== sid) return;
  writePending({ ...prev, status: "verified" });
}

/**
 * A pending record is expired when its backend `expiresAt` is past,
 * or — as a defence against missing/unparseable values — when it is
 * older than the backend TTL. Either condition makes the record
 * useless for downstream hooks.
 */
export function isExpired(
  state: PendingState,
  now: number = Date.now(),
): boolean {
  if (state.expiresAt) {
    const t = Date.parse(state.expiresAt);
    if (Number.isFinite(t)) return now >= t;
  }
  return now - state.createdAt > STEPUP_TTL_MS;
}
