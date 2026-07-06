type LatchRecord = {
    /** Per-prompt grouping id (`s_…`). */
    group: string;
    resource: string;
    action: string;
    /** Backend MFA session id (`tc_stepup_…`). */
    sid: string;
    createdAt: number;
    /** Stop-hook reminders emitted for this in-flight latch (cap in stop-reminder.ts). */
    remindedCount?: number;
};
export type LatchRecordWithCoordinate = LatchRecord;
/** Read a latch when present and non-expired; reaps stale/corrupt files. */
export declare function readLatchRecord(group: string, resource: string, action: string, now?: number): LatchRecordWithCoordinate | null;
/** True when a challenge for this coordinate is already in flight this prompt. */
export declare function hasLatch(group: string, resource: string, action: string, now?: number): boolean;
/** Best-effort claim. Overwrites unconditionally; never throws. Requires `sid`. */
export declare function writeLatch(group: string, resource: string, action: string, sid: string, now?: number, remindedCount?: number): void;
/** Best-effort release (poll terminal / self-heal). Never throws. */
export declare function clearLatch(group: string, resource: string, action: string): void;
/**
 * Drop the latch tied to a backend step-up session (poll terminal: rejected /
 * not-found). Scans the cache dir — best-effort, never throws.
 */
export declare function clearLatchBySid(sessionSid: string): void;
export type LatchInspection = {
    group: string;
    resource: string;
    action: string;
    created_at_ms: number;
    age_ms: number;
    expired: boolean;
};
/** Read-only snapshot of every latch on disk (for the inspect tool). */
export declare function listLatches(now?: number): LatchInspection[];
/**
 * Pending latch sid for evaluate reuse when this prompt has exactly one
 * in-flight latch; otherwise omit sid and let the backend resolve by group.
 */
export declare function readSinglePendingLatchSid(group: string, now?: number): string | undefined;
/** Bump the Stop reminder counter on a live latch. Never throws. */
export declare function incrementLatchRemindedCount(group: string, resource: string, action: string, now?: number): number | null;
/** Stop-hook reminder copy (cap enforced by the caller). */
export declare function formatStopReminderMessage(latch: LatchRecordWithCoordinate): string;
/** Reap expired latch files (Stop-hook housekeeping). */
export declare function sweepLatches(now?: number): void;
export {};
