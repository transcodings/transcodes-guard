type LatchRecord = {
    sid: string;
    resource: string;
    action: string;
    /** Backend-minted `tc_stepup_…` for poll → latch cleanup on terminal poll. */
    authSid?: string;
    createdAt: number;
    /** Stop-hook reminders emitted for this in-flight latch (cap in stop-reminder.ts). */
    remindedCount?: number;
};
export type LatchRecordWithCoordinate = LatchRecord & {
    resource: string;
    action: string;
};
/** Read a latch when present and non-expired; reaps stale/corrupt files. */
export declare function readLatchRecord(sid: string, resource: string, action: string, now?: number): LatchRecordWithCoordinate | null;
/** True when a challenge for this coordinate is already in flight this prompt. */
export declare function hasLatch(sid: string, resource: string, action: string, now?: number): boolean;
/** Best-effort claim. Overwrites unconditionally; never throws. */
export declare function writeLatch(sid: string, resource: string, action: string, authSid?: string, now?: number, remindedCount?: number): void;
/** Best-effort release (poll terminal / self-heal). Never throws. */
export declare function clearLatch(sid: string, resource: string, action: string): void;
/**
 * Drop the latch tied to a backend auth session (poll terminal: rejected /
 * not-found). Scans the cache dir — best-effort, never throws.
 */
export declare function clearLatchByAuthSid(authSid: string): void;
export type LatchInspection = {
    sid: string;
    resource: string;
    action: string;
    created_at_ms: number;
    age_ms: number;
    expired: boolean;
};
/** Read-only snapshot of every latch on disk (for the inspect tool). */
export declare function listLatches(now?: number): LatchInspection[];
/** Bump the Stop reminder counter on a live latch. Never throws. */
export declare function incrementLatchRemindedCount(sid: string, resource: string, action: string, now?: number): number | null;
/** Stop-hook reminder copy (cap enforced by the caller). */
export declare function formatStopReminderMessage(latch: LatchRecordWithCoordinate): string;
/**
 * Reap expired latch files (Stop-hook housekeeping). A latch older than the
 * step-up TTL is orphaned — the hook that wrote it was killed before it could
 * clear it. Best-effort: an unreadable cache dir is a silent no-op.
 */
export declare function sweepLatches(now?: number): void;
export {};
