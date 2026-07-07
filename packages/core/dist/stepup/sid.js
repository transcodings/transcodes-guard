/**
 * Per-prompt grouping id ("group") — client-minted, backend-grouped.
 *
 * Guard v3 grouping: evaluate sends the latch `sid` (`tc_stepup_…`); the backend
 * reuses `step-up-session:{sid}` when it still matches
 * `(group, resource, action)`. Poll with `GET .../step-up/session/:sid`.
 * Repeated tool calls in one prompt share the group; the latch file carries
 * the sid so siblings converge on one MFA challenge.
 *
 * It is NOT the `tc_stepup_` session sid (that is backend-minted per action and
 * lives in the auth URL) — the two never overlap.
 *
 * Persisted at `~/.transcodes/state/grouping-session.json`.
 *
 * Lifecycle:
 *   - `rotatePromptGroup()` mints a fresh group — called by the prompt-submit /
 *     session-start hooks so each user prompt starts a new grouping window.
 *   - `resolvePromptGroup()` returns the current group, minting one lazily when
 *     absent or older than the step-up TTL. Hosts without a prompt hook
 *     (Antigravity) rely on this TTL bucket.
 *
 * Crash-safe by construction: all disk I/O is wrapped so a broken cache dir
 * never throws into the gate — the fallback is an ephemeral in-memory group
 * (grouping degrades to off, never blocks).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cacheDir } from '../paths/index.js';
import { STEPUP_TTL_MS } from './config.js';
const GROUP_FILE = 'grouping-session.json';
function groupPath() {
    return path.join(cacheDir(), GROUP_FILE);
}
function mintGroup() {
    return `s_${randomBytes(12).toString('base64url')}`;
}
/** Best-effort persist. Swallows every error — the gate must never throw here. */
function persist(record) {
    try {
        writeFileSync(groupPath(), JSON.stringify(record), { mode: 0o600 });
    }
    catch {
        // Cache dir unwritable — the caller still gets the in-memory group.
    }
}
function readRecord(now) {
    let raw;
    try {
        raw = readFileSync(groupPath(), 'utf8');
    }
    catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        const obj = parsed;
        const group = typeof obj.group === 'string' && obj.group ? obj.group : null;
        const createdAt = typeof obj.createdAt === 'number' ? obj.createdAt : null;
        if (!group || createdAt === null)
            return null;
        if (now - createdAt > STEPUP_TTL_MS)
            return null;
        return { group, createdAt };
    }
    catch {
        return null;
    }
}
/** Mint a fresh grouping id and persist it (prompt-submit / session-start). */
export function rotatePromptGroup(now = Date.now()) {
    const record = { group: mintGroup(), createdAt: now };
    persist(record);
    return record.group;
}
/** Current grouping id; lazily mints (TTL bucket) when absent or expired. */
export function resolvePromptGroup(now = Date.now()) {
    const existing = readRecord(now);
    if (existing)
        return existing.group;
    return rotatePromptGroup(now);
}
/** Read-only peek at the current group (no mint). Null when absent/expired. */
export function peekPromptGroup(now = Date.now()) {
    return readRecord(now)?.group ?? null;
}
//# sourceMappingURL=sid.js.map