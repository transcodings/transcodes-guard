import { z } from 'zod';
declare const McpGrantSchema: z.ZodObject<{
    grantedAt: z.ZodNumber;
    sid: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sid: string;
    grantedAt: number;
}, {
    sid: string;
    grantedAt: number;
}>;
export type McpGrant = z.infer<typeof McpGrantSchema>;
declare const McpInflightSchema: z.ZodObject<{
    sid: z.ZodString;
    browserUrl: z.ZodString;
    startedAt: z.ZodNumber;
    /** Backend session `expiresAt` (RFC3339) when known — wins over startedAt+TTL. */
    expiresAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    sid: string;
    browserUrl: string;
    startedAt: number;
    expiresAt?: string | undefined;
}, {
    sid: string;
    browserUrl: string;
    startedAt: number;
    expiresAt?: string | undefined;
}>;
export type McpInflight = z.infer<typeof McpInflightSchema>;
/**
 * The live MCP grant, or null when there is none / it has lapsed. Self-healing:
 * an expired or malformed grant is consumed on read and reported absent. The
 * window is fixed at `grantedAt + MCP_GRANT_TTL_MS` (non-sliding).
 */
export declare function readMcpGrant(now?: number): McpGrant | null;
/** Whether an MCP grant is currently active. Thin wrapper over readMcpGrant. */
export declare function mcpGrantActive(now?: number): boolean;
/**
 * Open (or keep) the MCP grant for `sid`. No-op while a live grant already
 * exists, so `grantedAt` is stamped exactly once — repeated passes through the
 * gate cannot extend the 5-minute window (fixed, non-sliding).
 */
export declare function writeMcpGrant(sid: string, now?: number): void;
export declare function consumeMcpGrant(): void;
/**
 * The live in-flight record, or null when none / expired. Self-healing on an
 * expired or malformed record. Expiry follows the backend session window
 * (`expiresAt` when present, else `startedAt + STEPUP_TTL_MS`).
 */
export declare function readMcpInflight(now?: number): McpInflight | null;
/**
 * Atomically claim the right to run the single in-flight MCP step-up.
 *
 * Returns `{claimed:true}` when this process won the race and should create the
 * session + open the browser. Returns `{claimed:false, existing}` when another
 * step-up is already mid-flight — the caller should reuse `existing.sid` /
 * `existing.browserUrl` and emit a wait-deny instead of opening a second tab.
 *
 * Uses an `O_CREAT|O_EXCL` write so two same-tick processes cannot both claim.
 * A stale (expired) lock is cleared first so a crashed step-up never deadlocks
 * the gate. Best-effort: any I/O error other than the EEXIST race falls open
 * (claimed:true) — better a duplicate tab than a lost MFA prompt.
 */
export declare function claimMcpInflight(rec: Omit<McpInflight, 'startedAt'>, now?: number): {
    claimed: true;
} | {
    claimed: false;
    existing: McpInflight;
};
export declare function clearMcpInflight(): void;
export {};
