/**
 * Browser/poll dedup latch — the client's only local step-up state.
 *
 * Guard v3 keeps all step-up *status* on the backend step-up session (SSOT).
 * Poll: `GET /auth/temp-session/step-up/session/{authSid}`. The client keeps
 * only a per-coordinate latch file:
 *
 *   step-up.{sid}.{resource}.{action}.json
 *
 * Its sole job is to answer "did a sibling tool call in THIS prompt already
 * open a browser tab for this exact (sid, resource, action)?" so N concurrent
 * PreToolUse hooks converge on one MFA tab instead of N. Presence = a challenge
 * is already in flight; the hook that finds a latch denies with "poll the
 * existing session" and does NOT reopen the browser.
 *
 * Crash-safe by construction (spec §2): every write is `writeFileSync` with
 * swallowed errors and every delete is `rmSync({ force: true })`, so a torn
 * write, a missing file, or a lock collision never throws into the gate.
 *
 * Two layers reap a stale latch (host killed the hook before it could clear
 * one): `sweepLatches()` in the Stop hook drops any latch older than the TTL,
 * and the next `evaluatePreToolUse` for the same coordinate reconciles it
 * against the backend (SSOT) — a fresh session (exist:false) or a non-pending
 * status (verified/rejected) clears the latch immediately, so it can never
 * wedge the agent into a "keep authenticating" loop.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cacheDir } from '@transcodes-guard/plugin-paths';
import { STEPUP_TTL_MS } from './config.js';
const LATCH_PREFIX = 'step-up.';
const LATCH_SUFFIX = '.json';
/** Collapse anything outside `[A-Za-z0-9_-]` so the coordinate is a safe
 * single filename segment (resource/action are short slugs in practice). */
function slug(part) {
    return part.replace(/[^a-zA-Z0-9_-]/g, '_') || '_';
}
function latchName(sid, resource, action) {
    return `${LATCH_PREFIX}${slug(sid)}.${slug(resource)}.${slug(action)}${LATCH_SUFFIX}`;
}
function latchPath(sid, resource, action) {
    return path.join(cacheDir(), latchName(sid, resource, action));
}
function parseLatchRecord(file, now) {
    let raw;
    try {
        raw = readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed ||
            typeof parsed.sid !== 'string' ||
            typeof parsed.resource !== 'string' ||
            typeof parsed.action !== 'string' ||
            typeof parsed.createdAt !== 'number') {
            rmSync(file, { force: true });
            return null;
        }
        if (now - parsed.createdAt > STEPUP_TTL_MS) {
            rmSync(file, { force: true });
            return null;
        }
        return {
            sid: parsed.sid,
            resource: parsed.resource,
            action: parsed.action,
            authSid: parsed.authSid?.trim() || undefined,
            createdAt: parsed.createdAt,
            remindedCount: typeof parsed.remindedCount === 'number' &&
                Number.isInteger(parsed.remindedCount) &&
                parsed.remindedCount >= 0
                ? parsed.remindedCount
                : undefined,
        };
    }
    catch {
        try {
            rmSync(file, { force: true });
        }
        catch {
            // best-effort
        }
        return null;
    }
}
/** Read a latch when present and non-expired; reaps stale/corrupt files. */
export function readLatchRecord(sid, resource, action, now = Date.now()) {
    return parseLatchRecord(latchPath(sid, resource, action), now);
}
/** True when a challenge for this coordinate is already in flight this prompt. */
export function hasLatch(sid, resource, action, now = Date.now()) {
    return readLatchRecord(sid, resource, action, now) !== null;
}
/** Best-effort claim. Overwrites unconditionally; never throws. */
export function writeLatch(sid, resource, action, authSid, now = Date.now(), remindedCount) {
    const record = {
        sid,
        resource,
        action,
        authSid: authSid?.trim() || undefined,
        createdAt: now,
        remindedCount: typeof remindedCount === 'number' &&
            Number.isInteger(remindedCount) &&
            remindedCount >= 0
            ? remindedCount
            : undefined,
    };
    try {
        writeFileSync(latchPath(sid, resource, action), JSON.stringify(record), {
            mode: 0o600,
        });
    }
    catch {
        // Unwritable cache dir — dedup degrades to "always relaunch", never blocks.
    }
}
/** Best-effort release (poll terminal / self-heal). Never throws. */
export function clearLatch(sid, resource, action) {
    try {
        rmSync(latchPath(sid, resource, action), { force: true });
    }
    catch {
        // best-effort
    }
}
/**
 * Drop the latch tied to a backend auth session (poll terminal: rejected /
 * not-found). Scans the cache dir — best-effort, never throws.
 */
export function clearLatchByAuthSid(authSid) {
    const needle = authSid?.trim();
    if (!needle)
        return;
    let names;
    try {
        names = readdirSync(cacheDir());
    }
    catch {
        return;
    }
    for (const name of names) {
        if (!name.startsWith(LATCH_PREFIX) || !name.endsWith(LATCH_SUFFIX)) {
            continue;
        }
        const file = path.join(cacheDir(), name);
        try {
            const parsed = JSON.parse(readFileSync(file, 'utf8'));
            if (parsed?.authSid === needle) {
                rmSync(file, { force: true });
            }
        }
        catch {
            // skip corrupt latch
        }
    }
}
/** Read-only snapshot of every latch on disk (for the inspect tool). */
export function listLatches(now = Date.now()) {
    let names;
    try {
        names = readdirSync(cacheDir());
    }
    catch {
        return [];
    }
    const out = [];
    for (const name of names) {
        if (!name.startsWith(LATCH_PREFIX) || !name.endsWith(LATCH_SUFFIX)) {
            continue;
        }
        try {
            const parsed = JSON.parse(readFileSync(path.join(cacheDir(), name), 'utf8'));
            if (!parsed ||
                typeof parsed.sid !== 'string' ||
                typeof parsed.resource !== 'string' ||
                typeof parsed.action !== 'string' ||
                typeof parsed.createdAt !== 'number') {
                continue;
            }
            out.push({
                sid: parsed.sid,
                resource: parsed.resource,
                action: parsed.action,
                created_at_ms: parsed.createdAt,
                age_ms: now - parsed.createdAt,
                expired: now - parsed.createdAt > STEPUP_TTL_MS,
            });
        }
        catch {
            // skip corrupt latch
        }
    }
    return out;
}
/** Bump the Stop reminder counter on a live latch. Never throws. */
export function incrementLatchRemindedCount(sid, resource, action, now = Date.now()) {
    const rec = readLatchRecord(sid, resource, action, now);
    if (!rec)
        return null;
    const next = (rec.remindedCount ?? 0) + 1;
    writeLatch(sid, resource, action, rec.authSid, rec.createdAt, next);
    return next;
}
/** Stop-hook reminder copy (cap enforced by the caller). */
export function formatStopReminderMessage(latch) {
    const authSid = latch.authSid?.trim() ||
        '(use the tc_stepup_ sid from the PreToolUse deny message)';
    return [
        'transcodes-guard: a step-up MFA session is still PENDING. The tool',
        'call it gated was NOT executed. Resume the loop or report to the',
        'user that authentication is still required.',
        '',
        `Session sid     : ${authSid}`,
        `Coordinate      : ${latch.resource}:${latch.action}`,
        '',
        'Next action:',
        `  - Call MCP tool \`tc_poll_stepup_session_wait\` with sid="${authSid}".`,
        '  - On `outcome: "verified"` retry the exact original tool call.',
    ].join('\n');
}
/**
 * Reap expired latch files (Stop-hook housekeeping). A latch older than the
 * step-up TTL is orphaned — the hook that wrote it was killed before it could
 * clear it. Best-effort: an unreadable cache dir is a silent no-op.
 */
export function sweepLatches(now = Date.now()) {
    let names;
    try {
        names = readdirSync(cacheDir());
    }
    catch {
        return;
    }
    for (const name of names) {
        if (!name.startsWith(LATCH_PREFIX) || !name.endsWith(LATCH_SUFFIX)) {
            continue;
        }
        const file = path.join(cacheDir(), name);
        let createdAt = null;
        try {
            const parsed = JSON.parse(readFileSync(file, 'utf8'));
            if (parsed && typeof parsed === 'object') {
                const v = parsed.createdAt;
                if (typeof v === 'number')
                    createdAt = v;
            }
        }
        catch {
            // Corrupt/unreadable latch — treat as orphaned and remove below.
        }
        if (createdAt === null || now - createdAt > STEPUP_TTL_MS) {
            try {
                rmSync(file, { force: true });
            }
            catch {
                // best-effort
            }
        }
    }
}
//# sourceMappingURL=latch.js.map