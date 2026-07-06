/**
 * Browser/poll dedup latch — the client's only local step-up state.
 *
 * Guard v3 keeps all step-up *status* on the backend step-up session (SSOT).
 * Poll: `GET /auth/temp-session/step-up/session/{sid}`. The client keeps only a
 * per-coordinate latch file:
 *
 *   step-up.{group}.{resource}.{action}.json
 *
 * JSON shape:
 *   { group, resource, action, sid, createdAt, remindedCount? }
 *   - `group` — per-prompt grouping id (`s_…`, from resolvePromptGroup)
 *   - `sid`   — backend MFA session (`tc_stepup_…`), required for poll/evaluate reuse
 *
 * Its sole job is to answer "did a sibling tool call in THIS prompt already
 * open a browser tab for this exact (group, resource, action)?" so N concurrent
 * PreToolUse hooks converge on one MFA tab instead of N.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cacheDir } from '@transcodes-guard/plugin-paths';
import { STEPUP_TTL_MS } from './config.js';
const LATCH_PREFIX = 'step-up.';
const LATCH_SUFFIX = '.json';
function slug(part) {
    return part.replace(/[^a-zA-Z0-9_-]/g, '_') || '_';
}
function latchName(group, resource, action) {
    return `${LATCH_PREFIX}${slug(group)}.${slug(resource)}.${slug(action)}${LATCH_SUFFIX}`;
}
function latchPath(group, resource, action) {
    return path.join(cacheDir(), latchName(group, resource, action));
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
        const group = parsed?.group?.trim();
        if (!parsed ||
            !group ||
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
        const sid = parsed.sid?.trim();
        if (!sid) {
            rmSync(file, { force: true });
            return null;
        }
        return {
            group,
            resource: parsed.resource,
            action: parsed.action,
            sid,
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
export function readLatchRecord(group, resource, action, now = Date.now()) {
    return parseLatchRecord(latchPath(group, resource, action), now);
}
/** True when a challenge for this coordinate is already in flight this prompt. */
export function hasLatch(group, resource, action, now = Date.now()) {
    return readLatchRecord(group, resource, action, now) !== null;
}
/** Best-effort claim. Overwrites unconditionally; never throws. Requires `sid`. */
export function writeLatch(group, resource, action, sid, now = Date.now(), remindedCount) {
    const trimmed = sid.trim();
    if (!trimmed) {
        return;
    }
    const record = {
        group,
        resource,
        action,
        sid: trimmed,
        createdAt: now,
        remindedCount: typeof remindedCount === 'number' &&
            Number.isInteger(remindedCount) &&
            remindedCount >= 0
            ? remindedCount
            : undefined,
    };
    try {
        writeFileSync(latchPath(group, resource, action), JSON.stringify(record), {
            mode: 0o600,
        });
    }
    catch {
        // Unwritable cache dir — dedup degrades to "always relaunch", never blocks.
    }
}
/** Best-effort release (poll terminal / self-heal). Never throws. */
export function clearLatch(group, resource, action) {
    try {
        rmSync(latchPath(group, resource, action), { force: true });
    }
    catch {
        // best-effort
    }
}
/**
 * Drop the latch tied to a backend step-up session (poll terminal: rejected /
 * not-found). Scans the cache dir — best-effort, never throws.
 */
export function clearLatchBySid(sessionSid) {
    const needle = sessionSid?.trim();
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
            if (parsed?.sid?.trim() === needle) {
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
            const group = parsed?.group?.trim();
            if (!parsed ||
                !group ||
                typeof parsed.resource !== 'string' ||
                typeof parsed.action !== 'string' ||
                typeof parsed.createdAt !== 'number') {
                continue;
            }
            out.push({
                group,
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
/**
 * Pending latch sid for evaluate reuse when this prompt has exactly one
 * in-flight latch; otherwise omit sid and let the backend resolve by group.
 */
export function readSinglePendingLatchSid(group, now = Date.now()) {
    const needle = group.trim();
    if (!needle)
        return undefined;
    let names;
    try {
        names = readdirSync(cacheDir());
    }
    catch {
        return undefined;
    }
    let rec = null;
    for (const name of names) {
        if (!name.startsWith(LATCH_PREFIX) || !name.endsWith(LATCH_SUFFIX)) {
            continue;
        }
        const parsed = parseLatchRecord(path.join(cacheDir(), name), now);
        if (!parsed || parsed.group !== needle)
            continue;
        if (rec)
            return undefined;
        rec = parsed;
    }
    return rec?.sid;
}
/** Bump the Stop reminder counter on a live latch. Never throws. */
export function incrementLatchRemindedCount(group, resource, action, now = Date.now()) {
    const rec = readLatchRecord(group, resource, action, now);
    if (!rec)
        return null;
    const next = (rec.remindedCount ?? 0) + 1;
    writeLatch(group, resource, action, rec.sid, rec.createdAt, next);
    return next;
}
/** Stop-hook reminder copy (cap enforced by the caller). */
export function formatStopReminderMessage(latch) {
    const sessionSid = latch.sid;
    return [
        'transcodes-guard: a step-up MFA session is still PENDING. The tool',
        'call it gated was NOT executed. Resume the loop or report to the',
        'user that authentication is still required.',
        '',
        `Session sid     : ${sessionSid}`,
        `Coordinate      : ${latch.resource}:${latch.action}`,
        '',
        'Next action:',
        `  - Call MCP tool \`tc_poll_stepup_session_wait\` with sid="${sessionSid}".`,
        '  - On `outcome: "verified"` retry the exact original tool call.',
    ].join('\n');
}
/** Reap expired latch files (Stop-hook housekeeping). */
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