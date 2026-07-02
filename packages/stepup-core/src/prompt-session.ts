/**
 * Prompt-session bucket — the client half of resource/action step-up grouping.
 *
 * A "prompt session" is the unit inside which the backend groups approvals: a
 * step-up verified for one resource/action authorizes later commands with the
 * SAME coordinate (and NOT `delete`) without re-prompting. The bucket is just
 * an opaque id the hook sends to `POST /guard/evaluate` as `prompt_session_id`;
 * ALL grouping/delete/window policy lives in the backend. The client only:
 *   - mints/rotates the id, and
 *   - includes it on every evaluate call.
 *
 * Reset triggers (any one starts a fresh bucket → forces re-approval):
 *   1. New user prompt   — `rotatePromptSession()` from the UserPromptSubmit hook.
 *   2. 5-minute window   — `getPromptSessionId()` mints a new id once the record
 *                          is older than PROMPT_SESSION_TTL_MS (safety net for
 *                          hosts without a prompt-submit hook, e.g. Antigravity,
 *                          and for very long single prompts).
 *   3. Explicit lock     — `clearPromptSession()` (CLI / MCP tool).
 *
 * The id must stay stable across the deny → WebAuthn → retry round-trip (that
 * all happens inside one prompt turn), so rotation is tied to prompt submit,
 * NOT to individual tool calls.
 *
 * Storage: `~/.transcodes/state/prompt-session.json` (host-independent, via
 * @transcodes-guard/plugin-paths). Fail-open: any IO error degrades to a fresh
 * in-memory id so a broken file never blocks the gate.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cacheDir, migrateLegacyFile } from '@transcodes-guard/plugin-paths';

const PROMPT_SESSION_FILE = 'prompt-session.json';

/** Window after which a bucket auto-rotates even without a new prompt. */
export const PROMPT_SESSION_TTL_MS = 5 * 60 * 1_000;

export type PromptSession = {
  id: string;
  createdAt: number;
};

function promptSessionPath(): string {
  return path.join(cacheDir(), PROMPT_SESSION_FILE);
}

function mintId(): string {
  return `ps_${randomBytes(9).toString('base64url')}`;
}

function readRecord(): PromptSession | null {
  migrateLegacyFile(PROMPT_SESSION_FILE, 'cache');
  let raw: string;
  try {
    raw = readFileSync(promptSessionPath(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const id = typeof obj.id === 'string' && obj.id ? obj.id : null;
      const createdAt =
        typeof obj.createdAt === 'number' ? obj.createdAt : null;
      if (id && createdAt !== null) return { id, createdAt };
    }
  } catch {
    // malformed — treated as absent.
  }
  return null;
}

function writeRecord(record: PromptSession): void {
  try {
    mkdirSync(path.dirname(promptSessionPath()), { recursive: true });
    writeFileSync(promptSessionPath(), JSON.stringify(record), { mode: 0o600 });
  } catch {
    // Fail-open: the returned id is still usable for this process even if it
    // could not be persisted for the next hook subprocess.
  }
}

/**
 * The active bucket id, minting a fresh one when missing or older than
 * PROMPT_SESSION_TTL_MS. Called by the PreToolUse gate to tag `/guard/evaluate`.
 */
export function getPromptSessionId(now: number = Date.now()): string {
  const record = readRecord();
  if (record && now - record.createdAt <= PROMPT_SESSION_TTL_MS) {
    return record.id;
  }
  const next: PromptSession = { id: mintId(), createdAt: now };
  writeRecord(next);
  return next.id;
}

/**
 * Start a new bucket unconditionally (new user prompt = new grouping window).
 * Returns the new id. Called by the UserPromptSubmit hook.
 */
export function rotatePromptSession(now: number = Date.now()): string {
  const next: PromptSession = { id: mintId(), createdAt: now };
  writeRecord(next);
  return next.id;
}

/** Explicit lock: drop the bucket so the next command starts a fresh window. */
export function clearPromptSession(): void {
  try {
    rmSync(promptSessionPath(), { force: true });
  } catch {
    // best-effort cleanup
  }
}
