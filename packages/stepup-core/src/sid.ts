/**
 * Per-prompt grouping id ("sid") — client-minted, backend-grouped.
 *
 * Guard v3 grouping: the backend keys a pointer at
 * `guard:step-up:{sid}:{resource}:{action}` → `tc_stepup_` authSid. Status
 * always lives on the step-up session; poll with existing
 * `GET .../step-up/session/:authSid`.
 * Repeated tool calls in one prompt share the sid, so the backend dedupes them
 * onto a single MFA challenge (and a verified challenge grants the siblings).
 *
 * It is NOT the `tc_stepup_` auth token (that is backend-minted per action and
 * lives in the auth URL) — the two never overlap.
 *
 * Lifecycle:
 *   - `rotatePromptSid()` mints a fresh sid — called by the prompt-submit /
 *     session-start hooks so each user prompt starts a new grouping window.
 *   - `resolvePromptSid()` returns the current sid, minting one lazily when
 *     absent or older than the step-up TTL. Hosts without a prompt hook
 *     (Antigravity) rely on this TTL bucket.
 *
 * Crash-safe by construction: all disk I/O is wrapped so a broken cache dir
 * never throws into the gate — the fallback is an ephemeral in-memory sid
 * (grouping degrades to off, never blocks).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cacheDir } from '@transcodes-guard/plugin-paths';
import { STEPUP_TTL_MS } from './config.js';

const SID_FILE = 'stepup-sid.json';

type SidRecord = { sid: string; createdAt: number };

function sidPath(): string {
  return path.join(cacheDir(), SID_FILE);
}

function mintSid(): string {
  return `s_${randomBytes(12).toString('base64url')}`;
}

/** Best-effort persist. Swallows every error — the gate must never throw here. */
function persist(record: SidRecord): void {
  try {
    writeFileSync(sidPath(), JSON.stringify(record), { mode: 0o600 });
  } catch {
    // Cache dir unwritable — the caller still gets the in-memory sid.
  }
}

function readRecord(now: number): SidRecord | null {
  let raw: string;
  try {
    raw = readFileSync(sidPath(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const sid = typeof obj.sid === 'string' && obj.sid ? obj.sid : null;
    const createdAt = typeof obj.createdAt === 'number' ? obj.createdAt : null;
    if (!sid || createdAt === null) return null;
    if (now - createdAt > STEPUP_TTL_MS) return null;
    return { sid, createdAt };
  } catch {
    return null;
  }
}

/** Mint a fresh grouping sid and persist it (prompt-submit / session-start). */
export function rotatePromptSid(now: number = Date.now()): string {
  const record: SidRecord = { sid: mintSid(), createdAt: now };
  persist(record);
  return record.sid;
}

/** Current grouping sid; lazily mints (TTL bucket) when absent or expired. */
export function resolvePromptSid(now: number = Date.now()): string {
  const existing = readRecord(now);
  if (existing) return existing.sid;
  return rotatePromptSid(now);
}

/** Read-only peek at the current sid (no mint). Null when absent/expired. */
export function peekPromptSid(now: number = Date.now()): string | null {
  return readRecord(now)?.sid ?? null;
}
