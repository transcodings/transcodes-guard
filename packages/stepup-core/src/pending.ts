/**
 * Shared step-up state file(s) — the synchronisation clock between
 * PreToolUse, SessionStart, UserPromptSubmit, Stop hooks and the
 * poll_stepup_session MCP tool. Hooks cannot talk to each other or
 * to the MCP server directly; these files are the only synchronous
 * channel they share.
 *
 * Distinct from store.ts: that file is a single-shot "verified"
 * record consumed by PreToolUse's fast path. This one tracks the
 * pending session itself (sid, browserUrl, command, expiry) so the
 * secondary hooks can surface status to the agent without re-hitting
 * the backend.
 *
 * Two storage flavours mirror store.ts:
 *   - GLOBAL  `stepup-pending.json`        — MCP system-rule path.
 *   - FP-KEYED `stepup-pending.<fp>.json`  — hook-consume path (Bash + user
 *     tool-rules). The `fp` field inside the record selects the file; it
 *     also lets the poll tool map a sid back to its fingerprint so it writes
 *     the matching verified file (`findPendingBySid`).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { migrateLegacyFile } from "@transcodes-guard/plugin-paths";
import { consumeVerified, readVerified } from "./store.js";
import {
  isExpiredAt,
  listFingerprints,
  stepupDir,
  stepupFileName,
  stepupFilePath,
} from "./stepup-files.js";

/** File-name stem for pending records; GLOBAL/FP-KEYED naming, scan, and path
 * mechanics live in stepup-files.ts. */
const FILE_BASE = "stepup-pending";

const PendingStateSchema = z.object({
  sid: z.string().min(1),
  command: z.string(),
  reason: z.string(),
  browserUrl: z.string(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.string().optional(),
  status: z.enum(["pending", "verified"]),
  /** Present for the hook-consume (FP-KEYED) path; absent for the GLOBAL
   * MCP system-rule path. Selects which file this record lives in. */
  fp: z.string().optional(),
});

export type PendingState = z.infer<typeof PendingStateSchema>;

function pendingPath(fp?: string): string {
  return stepupFilePath(FILE_BASE, fp);
}

function parsePendingRaw(file: string): PendingState | null {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = PendingStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readPending(fp?: string): PendingState | null {
  if (!fp) migrateLegacyFile(stepupFileName(FILE_BASE), "cache");
  return parsePendingRaw(pendingPath(fp));
}

/**
 * Write a pending record. The destination file is chosen by `state.fp`:
 * FP-KEYED when present, GLOBAL otherwise. Keeping the selector inside the
 * record means callers never have to thread fp separately.
 */
export function writePending(state: PendingState): void {
  const file = pendingPath(state.fp);
  mkdirSync(stepupDir(), { recursive: true });
  writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
}

export function clearPending(fp?: string): void {
  try {
    rmSync(pendingPath(fp), { force: true });
  } catch {
    // best-effort cleanup
  }
}

/** List every FP-KEYED pending record on disk (excludes the GLOBAL file). */
export function listFpPendings(): PendingState[] {
  const out: PendingState[] = [];
  for (const fp of listFingerprints(FILE_BASE)) {
    const rec = parsePendingRaw(pendingPath(fp));
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Map a session id back to its pending record (and thus its fp). Checks the
 * GLOBAL file first, then FP-KEYED files. Used by the poll tools, which know
 * only the sid but must write the verified record to the matching flavour.
 */
export function findPendingBySid(
  sid: string,
): { fp?: string; pending: PendingState } | null {
  const global = readPending();
  if (global && global.sid === sid) return { pending: global };
  for (const rec of listFpPendings()) {
    if (rec.sid === sid) return { fp: rec.fp, pending: rec };
  }
  return null;
}

export function markVerified(sid: string): void {
  const found = findPendingBySid(sid);
  if (!found) return;
  writePending({ ...found.pending, status: "verified" });
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
  return isExpiredAt(state.createdAt, state.expiresAt, now);
}

/** First non-expired, still-pending FP-KEYED record (for Stop reminders —
 * "still PENDING" wording requires status === "pending"). GLOBAL is handled
 * separately by the existing Stop-hook logic. */
export function firstInFlightFpPending(
  now: number = Date.now(),
): PendingState | null {
  for (const rec of listFpPendings()) {
    if (rec.status === "pending" && !isExpired(rec, now)) return rec;
  }
  return null;
}

/**
 * First non-expired pending record of ANY status (pending or verified), used
 * by the context-injection hooks (SessionStart / UserPromptSubmit /
 * beforeSubmitPrompt) that surface carry-over state to the agent. GLOBAL is
 * preferred (MCP system path, backward-compatible), then the first FP-KEYED
 * Bash/user record.
 */
export function firstActivePending(
  now: number = Date.now(),
): PendingState | null {
  const global = readPending();
  if (global && !isExpired(global, now)) return global;
  for (const rec of listFpPendings()) {
    if (!isExpired(rec, now)) return rec;
  }
  return null;
}

/**
 * Silent housekeeping for FP-KEYED files (GLOBAL orphan reap stays in the
 * Stop hook for backward-compatible behaviour). Two jobs:
 *   1. Reap orphans: a pending whose paired verified is gone but status is
 *      "verified" (consumed elsewhere), or an expired pending.
 *   2. Sweep expired verified files left behind by an authenticate-but-never-
 *      retry flow (readVerified already self-consumes on the expiry read).
 * Best-effort and side-effect only — never throws into a hook.
 */
export function sweepStepup(now: number = Date.now()): void {
  for (const rec of listFpPendings()) {
    const fp = rec.fp;
    if (!fp) continue;
    if (rec.status === "verified" && !readVerified(fp)) {
      // paired verified already consumed/expired → pending is an orphan.
      clearPending(fp);
      continue;
    }
    if (isExpired(rec, now)) {
      clearPending(fp);
      consumeVerified(fp);
    }
  }
}
