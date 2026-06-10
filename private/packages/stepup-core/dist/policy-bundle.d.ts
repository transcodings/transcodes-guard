import { z } from 'zod';
import type { StepupConfig } from './config.js';
/** Bundle refresh TTL. Policy changes are infrequent and refresh runs only on
 * session-start/server boot (never per tool call), so 1h is the PRD default.
 * OPA-style 10–120s polling assumes a resident daemon — hooks are short-lived. */
export declare const POLICY_BUNDLE_TTL_MS: number;
/** Mirrors `ToolRule` in @transcodes-guard-private/danger-rules, as a zod
 * schema — backend responses are untrusted input like any other (a partially
 * corrupt bundle must never take the gate down). */
declare const bundleToolRuleSchema: z.ZodObject<{
    id: z.ZodString;
    toolName: z.ZodString;
    reason: z.ZodString;
    stepupAction: z.ZodEnum<["create", "read", "update", "delete"]>;
    stepupResource: z.ZodString;
    consume_in_hook: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    reason: string;
    id: string;
    stepupResource: string;
    stepupAction: "create" | "read" | "update" | "delete";
    toolName: string;
    consume_in_hook?: boolean | undefined;
}, {
    reason: string;
    id: string;
    stepupResource: string;
    stepupAction: "create" | "read" | "update" | "delete";
    toolName: string;
    consume_in_hook?: boolean | undefined;
}>;
declare const policyBundleSchema: z.ZodObject<{
    revision: z.ZodString;
    rules: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        toolName: z.ZodString;
        reason: z.ZodString;
        stepupAction: z.ZodEnum<["create", "read", "update", "delete"]>;
        stepupResource: z.ZodString;
        consume_in_hook: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        reason: string;
        id: string;
        stepupResource: string;
        stepupAction: "create" | "read" | "update" | "delete";
        toolName: string;
        consume_in_hook?: boolean | undefined;
    }, {
        reason: string;
        id: string;
        stepupResource: string;
        stepupAction: "create" | "read" | "update" | "delete";
        toolName: string;
        consume_in_hook?: boolean | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    revision: string;
    rules: {
        reason: string;
        id: string;
        stepupResource: string;
        stepupAction: "create" | "read" | "update" | "delete";
        toolName: string;
        consume_in_hook?: boolean | undefined;
    }[];
}, {
    revision: string;
    rules: {
        reason: string;
        id: string;
        stepupResource: string;
        stepupAction: "create" | "read" | "update" | "delete";
        toolName: string;
        consume_in_hook?: boolean | undefined;
    }[];
}>;
export type PolicyBundleRule = z.infer<typeof bundleToolRuleSchema>;
export type PolicyBundle = z.infer<typeof policyBundleSchema>;
export declare class PolicyBundleError extends Error {
}
/** Hex SHA-384 of the canonical JSON of `body`. Exported so fixtures/tests and
 * the backend implementation can pin the exact same contract. */
export declare function policyBundleSha384(body: unknown): string;
/**
 * OPA "verify before activate": manifest hash first, schema second. Throws
 * `PolicyBundleError` on any failure — callers keep the previous cache.
 */
export declare function verifyAndParsePolicyBundle(raw: unknown): PolicyBundle;
export type CachedPolicyBundle = {
    bundle: PolicyBundle;
    /** Epoch ms of the last successful fetch (or 304 touch). */
    fetchedAt: number;
    /** Within TTL. A stale (`fresh: false`) bundle is still returned —
     * last-known-good keeps gated coordinates working when the backend is
     * unreachable (fail-closed matrix row 2). */
    fresh: boolean;
};
export declare function policyBundleCachePath(organizationId: string): string;
/**
 * Fail-open read: missing/corrupt/schema-invalid cache reads as absent (the
 * caller falls back to the built-in baseline — fail-closed matrix row 3).
 * Integrity was verified at write time and the write is atomic, so the read
 * path re-checks shape only, not the manifest hash.
 */
export declare function readCachedPolicyBundle(organizationId: string, ttlMs?: number): CachedPolicyBundle | null;
/** Atomic write (temp + rename): several hooks may boot concurrently and a
 * reader must never see a torn file. */
export declare function writeCachedPolicyBundle(organizationId: string, bundle: PolicyBundle): void;
export type FetchPolicyBundleResult = {
    kind: 'fetched';
    bundle: PolicyBundle;
} | {
    kind: 'not-modified';
} | {
    kind: 'error';
    message: string;
};
/**
 * GET /v1/guard/policy-bundle (org scope comes from the token). When
 * `currentRevision` is set the backend may answer 304. Never throws — every
 * failure mode collapses to `{ kind: 'error' }` so refresh stays non-fatal.
 */
export declare function fetchPolicyBundle(config: StepupConfig, currentRevision?: string): Promise<FetchPolicyBundleResult>;
export type PolicyBundleRefreshOutcome = 
/** Cache within TTL — no network. */
'fresh'
/** New revision fetched, verified, cached. */
 | 'refreshed'
/** Backend confirmed our revision is current — TTL restarted. */
 | 'not-modified'
/** Fetch/verify/write failed — previous cache (if any) left untouched. */
 | 'failed';
/**
 * TTL-gated refresh — the single entry point Unit G2 wires into the
 * SessionStart hooks and MCP server boot. Failure is logged to stderr and
 * never thrown: a refresh problem must not block a session (the gate falls
 * back to last-known-good, then to the built-in baseline).
 */
export declare function refreshPolicyBundle(config: StepupConfig, opts?: {
    force?: boolean;
    ttlMs?: number;
}): Promise<PolicyBundleRefreshOutcome>;
export {};
