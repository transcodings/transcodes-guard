/**
 * MCP-only time-based step-up exemption — the "grant" — plus the global
 * in-flight lock that stops a burst of concurrent MCP calls from each opening
 * its own WebAuthn tab.
 *
 * This is a separate exemption LAYER on top of the existing single-shot
 * verified/pending mechanism (store.ts / pending.ts), not a replacement.
 * Both files here are GLOBAL only (no fp flavour): the grant is an exemption
 * for *MCP tool calls as a class*, not for one specific command, so keying it
 * by command fingerprint would defeat the purpose. Bash never reads or writes
 * these files — it keeps its per-command, no-ambient-authority model intact
 * (the file names cannot collide with `stepup-verified.<fp>.json`).
 *
 * Two records, one cache dir (host-aware via @transcodes-guard/plugin-paths):
 *   - `mcp-grant.json`           `{ grantedAt, sid }`  — the 5-minute exemption.
 *   - `mcp-stepup-inflight.json` `{ sid, browserUrl, startedAt, expiresAt? }`
 *                                — a step-up is mid-flight; suppress new ones.
 *
 * The exemption window is FIXED (counted from `grantedAt`), never sliding:
 * `writeMcpGrant` is a no-op while a live grant exists, so passing through the
 * gate does not extend it (see MCP_GRANT_TTL_MS).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { MCP_GRANT_TTL_MS } from './config.js';
import { isExpiredAt, stepupDir, stepupFilePath } from './stepup-files.js';

const GRANT_FILE_BASE = 'mcp-grant';
const INFLIGHT_FILE_BASE = 'mcp-stepup-inflight';

const McpGrantSchema = z.object({
  grantedAt: z.number().int().nonnegative(),
  sid: z.string().min(1),
});
export type McpGrant = z.infer<typeof McpGrantSchema>;

const McpInflightSchema = z.object({
  sid: z.string().min(1),
  browserUrl: z.string(),
  startedAt: z.number().int().nonnegative(),
  /** Backend session `expiresAt` (RFC3339) when known — wins over startedAt+TTL. */
  expiresAt: z.string().optional(),
});
export type McpInflight = z.infer<typeof McpInflightSchema>;

function grantPath(): string {
  return stepupFilePath(GRANT_FILE_BASE);
}

function inflightPath(): string {
  return stepupFilePath(INFLIGHT_FILE_BASE);
}

function parse<T>(file: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The live MCP grant, or null when there is none / it has lapsed. Self-healing:
 * an expired or malformed grant is consumed on read and reported absent. The
 * window is fixed at `grantedAt + MCP_GRANT_TTL_MS` (non-sliding).
 */
export function readMcpGrant(now: number = Date.now()): McpGrant | null {
  const rec = parse(grantPath(), McpGrantSchema);
  if (!rec) return null;
  if (now - rec.grantedAt >= MCP_GRANT_TTL_MS) {
    consumeMcpGrant();
    return null;
  }
  return rec;
}

/** Whether an MCP grant is currently active. Thin wrapper over readMcpGrant. */
export function mcpGrantActive(now: number = Date.now()): boolean {
  return readMcpGrant(now) !== null;
}

/**
 * Open (or keep) the MCP grant for `sid`. No-op while a live grant already
 * exists, so `grantedAt` is stamped exactly once — repeated passes through the
 * gate cannot extend the 5-minute window (fixed, non-sliding).
 */
export function writeMcpGrant(sid: string, now: number = Date.now()): void {
  if (readMcpGrant(now)) return;
  mkdirSync(stepupDir(), { recursive: true });
  const rec: McpGrant = { grantedAt: now, sid };
  writeFileSync(grantPath(), JSON.stringify(rec), { mode: 0o600 });
}

export function consumeMcpGrant(): void {
  try {
    rmSync(grantPath(), { force: true });
  } catch {
    // best-effort cleanup
  }
}

/**
 * The live in-flight record, or null when none / expired. Self-healing on an
 * expired or malformed record. Expiry follows the backend session window
 * (`expiresAt` when present, else `startedAt + STEPUP_TTL_MS`).
 */
export function readMcpInflight(now: number = Date.now()): McpInflight | null {
  const rec = parse(inflightPath(), McpInflightSchema);
  if (!rec) return null;
  if (isExpiredAt(rec.startedAt, rec.expiresAt, now)) {
    clearMcpInflight();
    return null;
  }
  return rec;
}

/**
 * Atomically claim the right to run the single in-flight MCP step-up.
 *
 * Returns `{claimed:true}` when this process won the race and should create the
 * session + open the browser. Returns `{claimed:false, existing}` when another
 * step-up is already mid-flight — the caller should reuse `existing.sid` /
 * `existing.browserUrl` and emit a wait-deny instead of opening a second tab.
 *
 * Uses an `O_CREAT|O_EXCL` write so two same-tick processes cannot both claim.
 * A stale (expired) lock is cleared first so a crashed step-up never deadlocks
 * the gate. Best-effort: any I/O error other than the EEXIST race falls open
 * (claimed:true) — better a duplicate tab than a lost MFA prompt.
 */
export function claimMcpInflight(
  rec: Omit<McpInflight, 'startedAt'>,
  now: number = Date.now(),
): { claimed: true } | { claimed: false; existing: McpInflight } {
  const existing = readMcpInflight(now); // clears a stale lock as a side effect
  if (existing) return { claimed: false, existing };
  const payload: McpInflight = { ...rec, startedAt: now };
  try {
    mkdirSync(stepupDir(), { recursive: true });
    writeFileSync(inflightPath(), JSON.stringify(payload), {
      mode: 0o600,
      flag: 'wx',
    });
    return { claimed: true };
  } catch (err) {
    // Lost the same-tick race: someone created the lock between our read and
    // write. Re-read so the caller can defer to the winner's session.
    if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') {
      const winner = readMcpInflight(now);
      if (winner) return { claimed: false, existing: winner };
    }
    // Any other I/O failure → fall open so MFA visibility is never lost.
    return { claimed: true };
  }
}

export function clearMcpInflight(): void {
  try {
    rmSync(inflightPath(), { force: true });
  } catch {
    // best-effort cleanup
  }
}
