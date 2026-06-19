/**
 * Project-scoped policy bundle (D5) — fetch / verify / cache (Phase 3 v2 Unit G, G1).
 *
 * The backend distributes system/org tool-rules as a runtime bundle
 * (TLS + SHA-384 manifest — decision D3) instead of baking them into the
 * plugin dist. This module owns the client core only:
 *
 *   fetch (token-auth, revision-aware) → verify (manifest hash + zod schema)
 *   → cache (atomic write under cacheDir()).
 *
 * Wiring into the SessionStart hooks / MCP server start is Unit G2; merging
 * cached rules into `loadMergedToolRules()` is Unit G3. The PreToolUse hook
 * must never call `fetchPolicyBundle`/`refreshPolicyBundle` — the hook
 * critical path reads the cache only (phase3 v2 design invariant 2).
 *
 * Integrity contract (must match the backend): `manifest.sha384` is the hex
 * SHA-384 of the canonical JSON of the response body WITHOUT the `manifest`
 * field — `{ schemaVersion, revision, rules }`. Canonical = object keys sorted
 * recursively (RFC 8785 spirit), arrays in order, no whitespace.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  coerceRbacAction,
  coerceRbacResource,
  loadMergedPatterns,
  loadMergedToolRules,
  type MergedPattern,
  type MergedToolRule,
  RBAC_ACTIONS,
  type ToolRule,
} from '@transcodes-guard/danger-patterns';
import { cacheDir } from '@transcodes-guard/plugin-paths';
import { z } from 'zod';
import { request } from './client.js';
import { loadStepupConfig, type StepupConfig } from './config.js';

/** Policy bundle wire schema version — bump on breaking bundle shape changes. */
export const GUARD_POLICY_BUNDLE_SCHEMA_VERSION = 3;

/** Bundle refresh TTL. Policy changes are infrequent and refresh runs only on
 * session-start/server boot (never per tool call), so 1h is the PRD default.
 * OPA-style 10–120s polling assumes a resident daemon — hooks are short-lived. */
export const POLICY_BUNDLE_TTL_MS = 60 * 60 * 1_000;

/** Refresh runs at session-start/server boot where a hung backend would delay
 * the session — keep the fetch bounded well under the host's hook timeout. */
export const POLICY_BUNDLE_FETCH_TIMEOUT_MS = 3_000;

/** Mirrors backend `GuardBundleRuleResponseDto` — active rules only, no status/metadata. */
const bundleToolRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  type: z.enum(['mcp', 'bash']),
  label: z.string().min(1),
  description: z.string().min(1),
  name: z.string().min(1),
  matcher: z.enum(['exact', 'glob', 'regex']),
  provider: z.enum(['claude', 'codex', 'cursor', 'antigravity']).optional(),
  action: z.enum(RBAC_ACTIONS).optional(),
  resource: z.string().min(1).optional(),
});

const policyBundleSchema = z.object({
  schemaVersion: z.literal(GUARD_POLICY_BUNDLE_SCHEMA_VERSION),
  revision: z.string().min(1),
  rules: z.array(bundleToolRuleSchema),
});

const manifestSchema = z.object({
  sha384: z.string().regex(/^[0-9a-f]{96}$/i),
});

export type PolicyBundleRule = z.infer<typeof bundleToolRuleSchema>;
export type PolicyBundle = z.infer<typeof policyBundleSchema>;

export class PolicyBundleError extends Error {}

/** Canonical JSON: recursively key-sorted, compact. `undefined` object values
 * are dropped (they would not survive JSON serialization anyway). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(',')}}`;
}

/** Hex SHA-384 of the canonical JSON of `body`. Exported so fixtures/tests and
 * the backend implementation can pin the exact same contract. */
export function policyBundleSha384(body: unknown): string {
  return createHash('sha384').update(canonicalJson(body), 'utf8').digest('hex');
}

/**
 * OPA "verify before activate": manifest hash first, schema second. Throws
 * `PolicyBundleError` on any failure — callers keep the previous cache.
 */
export function verifyAndParsePolicyBundle(raw: unknown): PolicyBundle {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PolicyBundleError('bundle body is not an object');
  }
  const { manifest, ...body } = raw as Record<string, unknown>;
  const manifestParsed = manifestSchema.safeParse(manifest);
  if (!manifestParsed.success) {
    throw new PolicyBundleError('manifest.sha384 missing or malformed');
  }
  const expected = manifestParsed.data.sha384.toLowerCase();
  const actual = policyBundleSha384(body);
  if (actual !== expected) {
    throw new PolicyBundleError(
      `manifest sha384 mismatch (manifest=${expected.slice(0, 12)}…, body=${actual.slice(0, 12)}…)`,
    );
  }
  const parsed = policyBundleSchema.safeParse(body);
  if (!parsed.success) {
    throw new PolicyBundleError(
      `bundle schema invalid: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

export type CachedPolicyBundle = {
  bundle: PolicyBundle;
  /** Epoch ms of the last successful fetch (or 304 touch). */
  fetchedAt: number;
  /** Within TTL. A stale (`fresh: false`) bundle is still returned —
   * last-known-good keeps gated coordinates working when the backend is
   * unreachable (fail-closed matrix row 2). */
  fresh: boolean;
};

type CacheEnvelope = {
  fetchedAt: number;
  bundle: PolicyBundle;
};

export function policyBundleCachePath(projectId: string): string {
  // The project id lands in a filename; it comes from a JWT claim, so neutralize
  // path separators and friends rather than trusting it.
  const safe = projectId.replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(cacheDir(), `policy-bundle.${safe}.json`);
}

/**
 * Fail-open read: missing/corrupt/schema-invalid cache reads as absent (the
 * caller falls back to the built-in baseline — fail-closed matrix row 3).
 * Integrity was verified at write time and the write is atomic, so the read
 * path re-checks shape only, not the manifest hash.
 */
export function readCachedPolicyBundle(
  projectId: string,
  ttlMs: number = POLICY_BUNDLE_TTL_MS,
): CachedPolicyBundle | null {
  let raw: string;
  try {
    raw = readFileSync(policyBundleCachePath(projectId), 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.fetchedAt !== 'number') {
    return null;
  }
  const bundle = policyBundleSchema.safeParse(envelope.bundle);
  if (!bundle.success) {
    return null;
  }
  return {
    bundle: bundle.data,
    fetchedAt: envelope.fetchedAt,
    fresh: Date.now() - envelope.fetchedAt < ttlMs,
  };
}

/** Atomic write (temp + rename): several hooks may boot concurrently and a
 * reader must never see a torn file. */
export function writeCachedPolicyBundle(
  projectId: string,
  bundle: PolicyBundle,
): void {
  const file = policyBundleCachePath(projectId);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const envelope: CacheEnvelope = { fetchedAt: Date.now(), bundle };
  writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
  renameSync(tmp, file);
}

export type FetchPolicyBundleResult =
  | { kind: 'fetched'; bundle: PolicyBundle }
  | { kind: 'not-modified' }
  | { kind: 'error'; message: string };

/** The backend wraps every response in `{ logId, success, statusCode,
 * payload: [...] }` (response.interceptor) — the bundle is `payload[0]` and
 * the manifest hash covers the bundle object, not the envelope. A bare body
 * passes through untouched so fixtures and a future non-enveloped backend
 * keep working. */
function unwrapBundleBody(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }
  const env = data as Record<string, unknown>;
  if (Array.isArray(env.payload) && ('success' in env || 'statusCode' in env)) {
    return env.payload[0];
  }
  return data;
}

/**
 * GET /v1/guard/policy-bundle (project scope comes from the token — D5). When
 * `currentRevision` is set the backend may answer 304. Never throws — every
 * failure mode collapses to `{ kind: 'error' }` so refresh stays non-fatal.
 */
export async function fetchPolicyBundle(
  config: StepupConfig,
  currentRevision?: string,
): Promise<FetchPolicyBundleResult> {
  const res = await request(config, {
    method: 'GET',
    path: '/guard/policy-bundle',
    query: { revision: currentRevision },
    timeoutMs: POLICY_BUNDLE_FETCH_TIMEOUT_MS,
  });
  if (res.status === 304) {
    return { kind: 'not-modified' };
  }
  if (!res.ok) {
    return {
      kind: 'error',
      message:
        res.status === 0
          ? 'backend unreachable'
          : `backend responded ${res.status}`,
    };
  }
  try {
    return {
      kind: 'fetched',
      bundle: verifyAndParsePolicyBundle(unwrapBundleBody(res.data)),
    };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type PolicyBundleRefreshOutcome =
  /** Cache within TTL — no network. */
  | 'fresh'
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
export async function refreshPolicyBundle(
  config: StepupConfig,
  opts: { force?: boolean; ttlMs?: number } = {},
): Promise<PolicyBundleRefreshOutcome> {
  try {
    const ttlMs = opts.ttlMs ?? POLICY_BUNDLE_TTL_MS;
    const cached = readCachedPolicyBundle(config.projectId, ttlMs);
    if (cached?.fresh && !opts.force) {
      return 'fresh';
    }
    const result = await fetchPolicyBundle(config, cached?.bundle.revision);
    if (result.kind === 'fetched') {
      writeCachedPolicyBundle(config.projectId, result.bundle);
      return 'refreshed';
    }
    if (result.kind === 'not-modified' && cached) {
      // Same revision server-side — rewrite to restart the TTL window.
      writeCachedPolicyBundle(config.projectId, cached.bundle);
      return 'not-modified';
    }
    if (result.kind === 'error') {
      console.error(
        `transcodes-guard: policy bundle refresh failed — keeping cached bundle (${result.message})`,
      );
    }
    return 'failed';
  } catch (err) {
    console.error(
      `transcodes-guard: policy bundle refresh failed — keeping cached bundle (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return 'failed';
  }
}

/**
 * Effective tool-rule set (Phase3 v2 G3): built-in baseline → cached org
 * bundle → user rules. Synchronous and cache-only — safe on the PreToolUse
 * critical path (design invariant 2). Without a resolvable token or a cached
 * bundle this degrades to the pre-G3 baseline+user merge. Staleness is
 * deliberately ignored here: a stale bundle is last-known-good (fail-closed
 * matrix row 2), and refresh happens elsewhere (G2 wiring).
 */
export function loadEffectiveToolRules(): MergedToolRule[] {
  let bundleRules: ToolRule[] = [];
  try {
    const config = loadStepupConfig();
    bundleRules = (readCachedPolicyBundle(config.projectId)?.bundle.rules ?? [])
      .filter((r) => r.type === 'mcp')
      .map((r) => ({ ...r, type: 'mcp' as const }));
  } catch {
    // no token → baseline only
  }
  return loadMergedToolRules(bundleRules);
}

/**
 * Effective Bash pattern set: built-in system patterns → cached bundle bash
 * rules (`type:'bash'`, regex in `name`). Cache-only — safe on PreToolUse path.
 */
export function loadEffectivePatterns(): MergedPattern[] {
  const system = loadMergedPatterns();
  let bundle: MergedPattern[] = [];
  try {
    const config = loadStepupConfig();
    const rules = readCachedPolicyBundle(config.projectId)?.bundle.rules ?? [];
    bundle = rules
      .filter((r) => r.type === 'bash')
      .map((r) => ({
        id: r.id,
        regex: r.name,
        reason: r.description,
        stepupResource: coerceRbacResource(r.resource),
        stepupAction: coerceRbacAction(r.action),
        source: 'bundle' as const,
      }));
  } catch {
    // no token → system baseline only
  }
  return [...system, ...bundle];
}

/**
 * Config-less refresh for the GateBackend seam (decision-audit pattern):
 * when no Transcodes token is resolvable this is a silent skip — an
 * unconfigured machine must boot exactly as before. Never throws.
 */
export async function refreshPolicyBundleIfConfigured(
  opts: { force?: boolean; ttlMs?: number } = {},
): Promise<PolicyBundleRefreshOutcome | 'skipped'> {
  let config: StepupConfig;
  try {
    config = loadStepupConfig();
  } catch {
    return 'skipped';
  }
  return refreshPolicyBundle(config, opts);
}
