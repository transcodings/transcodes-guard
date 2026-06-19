import { type MergedPattern, type MergedToolRule } from '@transcodes-guard/danger-patterns';
import { z } from 'zod';
import { type StepupConfig } from './config.js';
/** Policy bundle wire schema version — bump on breaking bundle shape changes. */
export declare const GUARD_POLICY_BUNDLE_SCHEMA_VERSION = 3;
/** Bundle refresh TTL. Policy changes are infrequent and refresh runs only on
 * session-start/server boot (never per tool call), so 1h is the PRD default.
 * OPA-style 10–120s polling assumes a resident daemon — hooks are short-lived. */
export declare const POLICY_BUNDLE_TTL_MS: number;
/** Refresh runs at session-start/server boot where a hung backend would delay
 * the session — keep the fetch bounded well under the host's hook timeout. */
export declare const POLICY_BUNDLE_FETCH_TIMEOUT_MS = 3000;
/** Mirrors backend `GuardBundleRuleResponseDto` — active rules only, no status/metadata. */
declare const bundleToolRuleSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["mcp", "bash"]>;
    label: z.ZodString;
    description: z.ZodString;
    name: z.ZodString;
    matcher: z.ZodEnum<["exact", "glob", "regex"]>;
    provider: z.ZodOptional<z.ZodEnum<["claude", "codex", "cursor", "antigravity"]>>;
    action: z.ZodOptional<z.ZodEnum<["create", "read", "update", "delete"]>>;
    resource: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    label: string;
    type: "mcp" | "bash";
    id: string;
    description: string;
    name: string;
    matcher: "exact" | "glob" | "regex";
    provider?: "claude" | "codex" | "cursor" | "antigravity" | undefined;
    action?: "create" | "read" | "update" | "delete" | undefined;
    resource?: string | undefined;
}, {
    label: string;
    type: "mcp" | "bash";
    id: string;
    description: string;
    name: string;
    matcher: "exact" | "glob" | "regex";
    provider?: "claude" | "codex" | "cursor" | "antigravity" | undefined;
    action?: "create" | "read" | "update" | "delete" | undefined;
    resource?: string | undefined;
}>;
declare const policyBundleSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<3>;
    revision: z.ZodString;
    rules: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<["mcp", "bash"]>;
        label: z.ZodString;
        description: z.ZodString;
        name: z.ZodString;
        matcher: z.ZodEnum<["exact", "glob", "regex"]>;
        provider: z.ZodOptional<z.ZodEnum<["claude", "codex", "cursor", "antigravity"]>>;
        action: z.ZodOptional<z.ZodEnum<["create", "read", "update", "delete"]>>;
        resource: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        label: string;
        type: "mcp" | "bash";
        id: string;
        description: string;
        name: string;
        matcher: "exact" | "glob" | "regex";
        provider?: "claude" | "codex" | "cursor" | "antigravity" | undefined;
        action?: "create" | "read" | "update" | "delete" | undefined;
        resource?: string | undefined;
    }, {
        label: string;
        type: "mcp" | "bash";
        id: string;
        description: string;
        name: string;
        matcher: "exact" | "glob" | "regex";
        provider?: "claude" | "codex" | "cursor" | "antigravity" | undefined;
        action?: "create" | "read" | "update" | "delete" | undefined;
        resource?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    schemaVersion: 3;
    revision: string;
    rules: {
        label: string;
        type: "mcp" | "bash";
        id: string;
        description: string;
        name: string;
        matcher: "exact" | "glob" | "regex";
        provider?: "claude" | "codex" | "cursor" | "antigravity" | undefined;
        action?: "create" | "read" | "update" | "delete" | undefined;
        resource?: string | undefined;
    }[];
}, {
    schemaVersion: 3;
    revision: string;
    rules: {
        label: string;
        type: "mcp" | "bash";
        id: string;
        description: string;
        name: string;
        matcher: "exact" | "glob" | "regex";
        provider?: "claude" | "codex" | "cursor" | "antigravity" | undefined;
        action?: "create" | "read" | "update" | "delete" | undefined;
        resource?: string | undefined;
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
export declare function policyBundleCachePath(projectId: string): string;
/**
 * Fail-open read: missing/corrupt/schema-invalid cache reads as absent (the
 * caller falls back to the built-in baseline — fail-closed matrix row 3).
 * Integrity was verified at write time and the write is atomic, so the read
 * path re-checks shape only, not the manifest hash.
 */
export declare function readCachedPolicyBundle(projectId: string, ttlMs?: number): CachedPolicyBundle | null;
/** Atomic write (temp + rename): several hooks may boot concurrently and a
 * reader must never see a torn file. */
export declare function writeCachedPolicyBundle(projectId: string, bundle: PolicyBundle): void;
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
 * GET /v1/guard/policy-bundle (project scope comes from the token — D5). When
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
/**
 * Effective tool-rule set (Phase3 v2 G3): built-in baseline → cached org
 * bundle → user rules. Synchronous and cache-only — safe on the PreToolUse
 * critical path (design invariant 2). Without a resolvable token or a cached
 * bundle this degrades to the pre-G3 baseline+user merge. Staleness is
 * deliberately ignored here: a stale bundle is last-known-good (fail-closed
 * matrix row 2), and refresh happens elsewhere (G2 wiring).
 */
export declare function loadEffectiveToolRules(): MergedToolRule[];
/**
 * Effective Bash pattern set: built-in system patterns → cached bundle bash
 * rules (`type:'bash'`, regex in `name`). Cache-only — safe on PreToolUse path.
 */
export declare function loadEffectivePatterns(): MergedPattern[];
/**
 * Config-less refresh for the GateBackend seam (decision-audit pattern):
 * when no Transcodes token is resolvable this is a silent skip — an
 * unconfigured machine must boot exactly as before. Never throws.
 */
export declare function refreshPolicyBundleIfConfigured(opts?: {
    force?: boolean;
    ttlMs?: number;
}): Promise<PolicyBundleRefreshOutcome | 'skipped'>;
export {};
