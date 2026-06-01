import { z } from "zod";
declare const PendingStateSchema: z.ZodObject<{
    sid: z.ZodString;
    command: z.ZodString;
    reason: z.ZodString;
    browserUrl: z.ZodString;
    createdAt: z.ZodNumber;
    expiresAt: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<["pending", "verified"]>;
}, "strip", z.ZodTypeAny, {
    status: "verified" | "pending";
    sid: string;
    browserUrl: string;
    reason: string;
    command: string;
    createdAt: number;
    expiresAt?: string | undefined;
}, {
    status: "verified" | "pending";
    sid: string;
    browserUrl: string;
    reason: string;
    command: string;
    createdAt: number;
    expiresAt?: string | undefined;
}>;
export type PendingState = z.infer<typeof PendingStateSchema>;
export declare function readPending(): PendingState | null;
export declare function writePending(state: PendingState): void;
export declare function clearPending(): void;
export declare function markVerified(sid: string): void;
/**
 * A pending record is expired when its backend `expiresAt` is past,
 * or — as a defence against missing/unparseable values — when it is
 * older than the backend TTL. Either condition makes the record
 * useless for downstream hooks.
 */
export declare function isExpired(state: PendingState, now?: number): boolean;
export {};
