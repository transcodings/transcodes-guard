import { z } from 'zod';
declare const PendingStateSchema: z.ZodObject<{
    sid: z.ZodString;
    command: z.ZodString;
    reason: z.ZodString;
    browserUrl: z.ZodString;
    createdAt: z.ZodNumber;
    expiresAt: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<["pending", "verified"]>;
    /** Present for the hook-consume (FP-KEYED) path; absent for the GLOBAL
     * MCP system-rule path. Selects which file this record lives in. */
    fp: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "verified" | "pending";
    sid: string;
    browserUrl: string;
    reason: string;
    command: string;
    createdAt: number;
    expiresAt?: string | undefined;
    fp?: string | undefined;
}, {
    status: "verified" | "pending";
    sid: string;
    browserUrl: string;
    reason: string;
    command: string;
    createdAt: number;
    expiresAt?: string | undefined;
    fp?: string | undefined;
}>;
export type PendingState = z.infer<typeof PendingStateSchema>;
export declare function readPending(fp?: string): PendingState | null;
/**
 * Write a pending record. The destination file is chosen by `state.fp`:
 * FP-KEYED when present, GLOBAL otherwise. Keeping the selector inside the
 * record means callers never have to thread fp separately.
 */
export declare function writePending(state: PendingState): void;
export declare function clearPending(fp?: string): void;
/** List every FP-KEYED pending record on disk (excludes the GLOBAL file). */
export declare function listFpPendings(): PendingState[];
/**
 * Map a session id back to its pending record (and thus its fp). Checks the
 * GLOBAL file first, then FP-KEYED files. Used by the poll tools, which know
 * only the sid but must write the verified record to the matching flavour.
 */
export declare function findPendingBySid(sid: string): {
    fp?: string;
    pending: PendingState;
} | null;
export declare function markVerified(sid: string): void;
/**
 * A pending record is expired when its backend `expiresAt` is past,
 * or — as a defence against missing/unparseable values — when it is
 * older than the backend TTL. Either condition makes the record
 * useless for downstream hooks.
 */
export declare function isExpired(state: PendingState, now?: number): boolean;
/** First non-expired, still-pending FP-KEYED record (for Stop reminders —
 * "still PENDING" wording requires status === "pending"). GLOBAL is handled
 * separately by the existing Stop-hook logic. */
export declare function firstInFlightFpPending(now?: number): PendingState | null;
/**
 * First non-expired pending record of ANY status (pending or verified), used
 * by the context-injection hooks (SessionStart / UserPromptSubmit /
 * beforeSubmitPrompt) that surface carry-over state to the agent. GLOBAL is
 * preferred (MCP system path, backward-compatible), then the first FP-KEYED
 * Bash/user record.
 */
export declare function firstActivePending(now?: number): PendingState | null;
/**
 * Silent housekeeping for FP-KEYED files (GLOBAL orphan reap stays in the
 * Stop hook for backward-compatible behaviour). Two jobs:
 *   1. Reap orphans: a pending whose paired verified is gone but status is
 *      "verified" (consumed elsewhere), or an expired pending.
 *   2. Sweep expired verified files left behind by an authenticate-but-never-
 *      retry flow (readVerified already self-consumes on the expiry read).
 * Best-effort and side-effect only — never throws into a hook.
 */
export declare function sweepStepup(now?: number): void;
export {};
