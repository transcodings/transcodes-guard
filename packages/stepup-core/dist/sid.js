/**
 * Per-prompt grouping id ("sid") — client-minted, backend-grouped.
 *
 * Guard v3 grouping: the backend keys a pointer at
 * `guard:step-up:{group}:{resource}:{action}` → `tc_stepup_` sid. Status
 * always lives on the step-up session; poll with existing
 * `GET .../step-up/session/:sid`.
 * Repeated tool calls in one prompt share the sid, so the backend dedupes them
 * onto a single MFA challenge (and a verified challenge grants the siblings).
 *
 * It is NOT the `tc_stepup_` session sid (that is backend-minted per action and
 * lives in the auth URL) — the two never overlap.
 *
 * Persisted at `~/.transcodes/state/grouping-session.json`.
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
const SID_FILE = 'grouping-session.json';
function sidPath() {
    return path.join(cacheDir(), SID_FILE);
}
function mintSid() {
    return `s_${randomBytes(12).toString('base64url')}`;
}
/** Best-effort persist. Swallows every error — the gate must never throw here. */
function persist(record) {
    try {
        writeFileSync(sidPath(), JSON.stringify(record), { mode: 0o600 });
    }
    catch {
        // Cache dir unwritable — the caller still gets the in-memory sid.
    }
}
function readRecord(now) {
    let raw;
    try {
        raw = readFileSync(sidPath(), 'utf8');
    }
    catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        const obj = parsed;
        const sid = typeof obj.sid === 'string' && obj.sid ? obj.sid : null;
        const createdAt = typeof obj.createdAt === 'number' ? obj.createdAt : null;
        if (!sid || createdAt === null)
            return null;
        if (now - createdAt > STEPUP_TTL_MS)
            return null;
        return { sid, createdAt };
    }
    catch {
        return null;
    }
}
/** Mint a fresh grouping sid and persist it (prompt-submit / session-start). */
export function rotatePromptSid(now = Date.now()) {
    const record = { sid: mintSid(), createdAt: now };
    persist(record);
    return record.sid;
}
/** Current grouping sid; lazily mints (TTL bucket) when absent or expired. */
export function resolvePromptSid(now = Date.now()) {
    const existing = readRecord(now);
    if (existing)
        return existing.sid;
    return rotatePromptSid(now);
}
/** Read-only peek at the current sid (no mint). Null when absent/expired. */
export function peekPromptSid(now = Date.now()) {
    return readRecord(now)?.sid ?? null;
}
//# sourceMappingURL=sid.js.map