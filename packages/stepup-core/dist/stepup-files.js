/**
 * Shared on-disk conventions for step-up state files.
 *
 * Three modules persist step-up state under the same cache dir with the same
 * two-flavour naming scheme:
 *   - GLOBAL   `<base>.json`         (MCP system-rule path)
 *   - FP-KEYED `<base>.<fp>.json`    (Bash + user tool-rules, content-addressed)
 *
 * The file-name builder, the FP-KEYED scan, and the expiry rule used to be
 * re-implemented in store.ts, pending.ts, and inspector.ts. They live here once
 * so a rename or rule change touches a single place. Each caller still owns its
 * own record validation and side-effect policy (store consumes on read, pending
 * uses zod, inspector is strictly read-only) — only the file mechanics are
 * shared.
 */
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cacheDir } from '@transcodes-guard/plugin-paths';
import { STEPUP_TTL_MS } from './config.js';
/**
 * On-disk file name for a step-up record. `fp` undefined → GLOBAL
 * `<base>.json`; a fingerprint → FP-KEYED `<base>.<fp>.json`.
 */
export function stepupFileName(base, fp) {
    return fp ? `${base}.${fp}.json` : `${base}.json`;
}
/** Absolute path in the shared cache dir for a step-up record. */
export function stepupFilePath(base, fp) {
    return path.join(cacheDir(), stepupFileName(base, fp));
}
/**
 * The directory every step-up state file lives in. Callers `mkdirSync` this
 * before a write; all flavours share the one cache dir, so there is no
 * per-file `path.dirname` to thread.
 */
export function stepupDir() {
    return cacheDir();
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Regex capturing the fingerprint segment of an FP-KEYED file for `base`.
 * The GLOBAL `<base>.json` deliberately does NOT match (it has no middle
 * segment), so scans never confuse the two flavours.
 */
export function fpFileRegex(base) {
    return new RegExp(`^${escapeRegex(base)}\\.([0-9a-f]+)\\.json$`);
}
/**
 * List every FP-KEYED fingerprint on disk for `base` (excludes the GLOBAL
 * file). Best-effort: an unreadable cache dir yields [] so callers (sweeps,
 * scans) never throw.
 */
export function listFingerprints(base) {
    const re = fpFileRegex(base);
    try {
        return readdirSync(cacheDir())
            .map((name) => re.exec(name)?.[1])
            .filter((fp) => typeof fp === 'string');
    }
    catch {
        return [];
    }
}
/**
 * Atomically write a step-up state file: write to a temp sibling, then
 * `renameSync` into place. rename is atomic on POSIX, so a concurrent reader
 * never sees a half-written file — important because `readVerified` consumes
 * (deletes) any record it reads as corrupt, so a torn read would destroy the
 * record a writer is mid-way through persisting. The temp name carries the pid
 * so two writers to the same base don't clobber each other's temp file.
 */
export function atomicWriteFile(file, contents) {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    writeFileSync(tmp, contents, { mode: 0o600 });
    renameSync(tmp, file);
}
/**
 * Shared expiry rule for verified + pending records: an explicit RFC3339
 * `expiresAt` (the backend's window) wins when present and parseable;
 * otherwise fall back to `age > ttl` as a defence against missing values.
 */
export function isExpiredAt(createdAt, expiresAt, now, ttlMs = STEPUP_TTL_MS) {
    if (expiresAt) {
        const t = Date.parse(expiresAt);
        if (Number.isFinite(t))
            return now >= t;
    }
    return now - createdAt > ttlMs;
}
//# sourceMappingURL=stepup-files.js.map