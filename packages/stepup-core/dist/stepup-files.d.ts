/**
 * On-disk file name for a step-up record. `fp` undefined → GLOBAL
 * `<base>.json`; a fingerprint → FP-KEYED `<base>.<fp>.json`.
 */
export declare function stepupFileName(base: string, fp?: string): string;
/** Absolute path in the shared cache dir for a step-up record. */
export declare function stepupFilePath(base: string, fp?: string): string;
/**
 * The directory every step-up state file lives in. Callers `mkdirSync` this
 * before a write; all flavours share the one cache dir, so there is no
 * per-file `path.dirname` to thread.
 */
export declare function stepupDir(): string;
/**
 * Regex capturing the fingerprint segment of an FP-KEYED file for `base`.
 * The GLOBAL `<base>.json` deliberately does NOT match (it has no middle
 * segment), so scans never confuse the two flavours.
 */
export declare function fpFileRegex(base: string): RegExp;
/**
 * List every FP-KEYED fingerprint on disk for `base` (excludes the GLOBAL
 * file). Best-effort: an unreadable cache dir yields [] so callers (sweeps,
 * scans) never throw.
 */
export declare function listFingerprints(base: string): string[];
/**
 * Atomically write a step-up state file: write to a temp sibling, then
 * `renameSync` into place. rename is atomic on POSIX, so a concurrent reader
 * never sees a half-written file — important because `readVerified` consumes
 * (deletes) any record it reads as corrupt, so a torn read would destroy the
 * record a writer is mid-way through persisting. The temp name carries the pid
 * so two writers to the same base don't clobber each other's temp file.
 */
export declare function atomicWriteFile(file: string, contents: string): void;
/**
 * Shared expiry rule for verified + pending records: an explicit RFC3339
 * `expiresAt` (the backend's window) wins when present and parseable;
 * otherwise fall back to `age > ttl` as a defence against missing values.
 */
export declare function isExpiredAt(createdAt: number, expiresAt: string | undefined, now: number, ttlMs?: number): boolean;
