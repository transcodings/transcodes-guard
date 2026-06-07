/**
 * Read-only inspector for step-up state files.
 *
 * Single source of truth that the agent reads to know what's on disk —
 * without spawning shells, parsing `ls` output, or trusting display
 * labels from wrapper tools. Every field is structured JSON; expiry is
 * computed deterministically against the same TTL constants the hook
 * uses, so the agent never has to guess from timestamps.
 *
 * Strict read-only: never calls consumeVerified / clearPending / write.
 * Even an expired record is reported intact so the agent can confirm
 * its state without side effects.
 */
import { readFileSync } from 'node:fs';
import { cacheDir, migrateLegacyFile } from '@transcodes-guard/plugin-paths';
import { STEPUP_TTL_MS } from './config.js';
import {
  isExpiredAt,
  listFingerprints,
  stepupFileName,
  stepupFilePath,
} from './stepup-files.js';

const VERIFIED_BASE = 'stepup-verified';
const PENDING_BASE = 'stepup-pending';
const BROWSER_LOCK_BASE = 'stepup-browser-lock';
const BROWSER_LOCK_TTL_MS = 15_000;
const COMMAND_PREVIEW_LIMIT = 120;

export type VerifiedInspection =
  | { exists: false }
  | {
      exists: true;
      sid: string;
      verified_at_ms: number;
      age_ms: number;
      expired: boolean;
      ttl_ms: number;
      /** Present for FP-KEYED records (Bash + user tool-rules); absent for
       * the GLOBAL MCP system-rule record. */
      fp?: string;
    };

export type PendingInspection =
  | { exists: false }
  | {
      exists: true;
      sid: string;
      status: 'pending' | 'verified';
      command_preview: string;
      browser_url: string;
      created_at_ms: number;
      age_ms: number;
      expired: boolean;
      expires_at?: string;
      fp?: string;
    };

export type BrowserLockInspection =
  | { exists: false }
  | {
      exists: true;
      fingerprint: string;
      opened_at_ms: number;
      age_ms: number;
      expired: boolean;
      ttl_ms: number;
    };

export type StepupStateInspection = {
  cache_dir: string;
  now_ms: number;
  /** GLOBAL records (MCP system-rule path). */
  verified: VerifiedInspection;
  pending: PendingInspection;
  /** FP-KEYED records (Bash + user tool-rules, content-addressed). Each
   * danger command in flight has its own entry — this is where the agent
   * looks to confirm its own command (matched by command_preview) is
   * verified, without picking up another sub-agent's record. */
  verified_fp: VerifiedInspection[];
  pending_fp: PendingInspection[];
  browser_lock: BrowserLockInspection;
};

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or unparseable — fall through to null.
  }
  return null;
}

function previewCommand(command: string): string {
  if (command.length <= COMMAND_PREVIEW_LIMIT) return command;
  return `${command.slice(0, COMMAND_PREVIEW_LIMIT)}…`;
}

function inspectVerifiedFile(
  file: string,
  now: number,
  fp?: string,
): VerifiedInspection {
  const data = readJsonFile(file);
  if (!data) return { exists: false };
  const sid = typeof data.sid === 'string' ? data.sid : null;
  const verifiedAt =
    typeof data.verifiedAt === 'number' ? data.verifiedAt : null;
  if (!sid || verifiedAt === null) return { exists: false };
  const ageMs = now - verifiedAt;
  return {
    exists: true,
    sid,
    verified_at_ms: verifiedAt,
    age_ms: ageMs,
    expired: isExpiredAt(verifiedAt, undefined, now),
    ttl_ms: STEPUP_TTL_MS,
    ...(fp ? { fp } : {}),
  };
}

function inspectVerified(now: number): VerifiedInspection {
  return inspectVerifiedFile(stepupFilePath(VERIFIED_BASE), now);
}

function inspectPendingFile(
  file: string,
  now: number,
  fp?: string,
): PendingInspection {
  const data = readJsonFile(file);
  if (!data) return { exists: false };
  const sid = typeof data.sid === 'string' ? data.sid : null;
  const status =
    data.status === 'verified' || data.status === 'pending'
      ? data.status
      : null;
  const createdAt = typeof data.createdAt === 'number' ? data.createdAt : null;
  const command = typeof data.command === 'string' ? data.command : null;
  const browserUrl = typeof data.browserUrl === 'string' ? data.browserUrl : '';
  if (!sid || !status || createdAt === null || command === null) {
    return { exists: false };
  }
  const ageMs = now - createdAt;
  const expiresAt =
    typeof data.expiresAt === 'string' ? data.expiresAt : undefined;
  const expired = isExpiredAt(createdAt, expiresAt, now);
  return {
    exists: true,
    sid,
    status,
    command_preview: previewCommand(command),
    browser_url: browserUrl,
    created_at_ms: createdAt,
    age_ms: ageMs,
    expired,
    expires_at: expiresAt,
    ...(fp ? { fp } : {}),
  };
}

function inspectPending(now: number): PendingInspection {
  return inspectPendingFile(stepupFilePath(PENDING_BASE), now);
}

function inspectBrowserLock(now: number): BrowserLockInspection {
  const file = stepupFilePath(BROWSER_LOCK_BASE);
  const data = readJsonFile(file);
  if (!data) return { exists: false };
  const fingerprint =
    typeof data.fingerprint === 'string' ? data.fingerprint : null;
  const openedAt = typeof data.openedAt === 'number' ? data.openedAt : null;
  if (!fingerprint || openedAt === null) return { exists: false };
  const ageMs = now - openedAt;
  return {
    exists: true,
    fingerprint,
    opened_at_ms: openedAt,
    age_ms: ageMs,
    expired: isExpiredAt(openedAt, undefined, now, BROWSER_LOCK_TTL_MS),
    ttl_ms: BROWSER_LOCK_TTL_MS,
  };
}

export function inspectStepupState(
  now: number = Date.now(),
): StepupStateInspection {
  migrateLegacyFile(stepupFileName(VERIFIED_BASE), 'cache');
  migrateLegacyFile(stepupFileName(PENDING_BASE), 'cache');
  migrateLegacyFile(stepupFileName(BROWSER_LOCK_BASE), 'cache');
  return {
    cache_dir: cacheDir(),
    now_ms: now,
    verified: inspectVerified(now),
    pending: inspectPending(now),
    verified_fp: listFingerprints(VERIFIED_BASE)
      .map((fp) =>
        inspectVerifiedFile(stepupFilePath(VERIFIED_BASE, fp), now, fp),
      )
      .filter(
        (v): v is Extract<VerifiedInspection, { exists: true }> => v.exists,
      ),
    pending_fp: listFingerprints(PENDING_BASE)
      .map((fp) =>
        inspectPendingFile(stepupFilePath(PENDING_BASE, fp), now, fp),
      )
      .filter(
        (p): p is Extract<PendingInspection, { exists: true }> => p.exists,
      ),
    browser_lock: inspectBrowserLock(now),
  };
}
