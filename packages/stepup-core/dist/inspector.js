/**
 * Read-only inspector for step-up state files.
 *
 * Single source of truth that the agent reads to know what's on disk —
 * without spawning shells, parsing `ls` output, or trusting display
 * labels from wrapper tools. Every field is structured JSON; expiry is
 * computed deterministically against the same TTL constants the hook
 * uses, so the agent never has to guess from timestamps.
 *
 * Strict read-only: never calls consumeVerified / clearPending / write.
 * Even an expired record is reported intact so the agent can confirm
 * its state without side effects.
 */
import { readFileSync } from 'node:fs';
import { cacheDir, migrateLegacyFile } from '@transcodes-guard/plugin-paths';
import { MCP_GRANT_TTL_MS, STEPUP_TTL_MS } from './config.js';
import { isExpiredAt, listFingerprints, stepupFileName, stepupFilePath, } from './stepup-files.js';
const VERIFIED_BASE = 'stepup-verified';
const PENDING_BASE = 'stepup-pending';
const BROWSER_LOCK_BASE = 'stepup-browser-lock';
const MCP_GRANT_BASE = 'mcp-grant';
const MCP_INFLIGHT_BASE = 'mcp-stepup-inflight';
const BROWSER_LOCK_TTL_MS = 15_000;
const COMMAND_PREVIEW_LIMIT = 120;
function readJsonFile(file) {
    try {
        const raw = readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        // Missing or unparseable — fall through to null.
    }
    return null;
}
function previewCommand(command) {
    if (command.length <= COMMAND_PREVIEW_LIMIT)
        return command;
    return `${command.slice(0, COMMAND_PREVIEW_LIMIT)}…`;
}
function inspectVerifiedFile(file, now, fp) {
    const data = readJsonFile(file);
    if (!data)
        return { exists: false };
    const sid = typeof data.sid === 'string' ? data.sid : null;
    const verifiedAt = typeof data.verifiedAt === 'number' ? data.verifiedAt : null;
    if (!sid || verifiedAt === null)
        return { exists: false };
    const ageMs = now - verifiedAt;
    return {
        exists: true,
        sid,
        verified_at_ms: verifiedAt,
        age_ms: ageMs,
        expired: isExpiredAt(verifiedAt, undefined, now),
        ttl_ms: STEPUP_TTL_MS,
        ...(fp ? { fp } : {}),
    };
}
function inspectVerified(now) {
    return inspectVerifiedFile(stepupFilePath(VERIFIED_BASE), now);
}
function inspectPendingFile(file, now, fp) {
    const data = readJsonFile(file);
    if (!data)
        return { exists: false };
    const sid = typeof data.sid === 'string' ? data.sid : null;
    const status = data.status === 'verified' || data.status === 'pending'
        ? data.status
        : null;
    const createdAt = typeof data.createdAt === 'number' ? data.createdAt : null;
    const command = typeof data.command === 'string' ? data.command : null;
    const browserUrl = typeof data.browserUrl === 'string' ? data.browserUrl : '';
    if (!sid || !status || createdAt === null || command === null) {
        return { exists: false };
    }
    const ageMs = now - createdAt;
    const expiresAt = typeof data.expiresAt === 'string' ? data.expiresAt : undefined;
    const expired = isExpiredAt(createdAt, expiresAt, now);
    return {
        exists: true,
        sid,
        status,
        command_preview: previewCommand(command),
        browser_url: browserUrl,
        created_at_ms: createdAt,
        age_ms: ageMs,
        expired,
        expires_at: expiresAt,
        ...(fp ? { fp } : {}),
    };
}
function inspectPending(now) {
    return inspectPendingFile(stepupFilePath(PENDING_BASE), now);
}
function inspectBrowserLock(now) {
    const file = stepupFilePath(BROWSER_LOCK_BASE);
    const data = readJsonFile(file);
    if (!data)
        return { exists: false };
    const fingerprint = typeof data.fingerprint === 'string' ? data.fingerprint : null;
    const openedAt = typeof data.openedAt === 'number' ? data.openedAt : null;
    if (!fingerprint || openedAt === null)
        return { exists: false };
    const ageMs = now - openedAt;
    return {
        exists: true,
        fingerprint,
        opened_at_ms: openedAt,
        age_ms: ageMs,
        expired: isExpiredAt(openedAt, undefined, now, BROWSER_LOCK_TTL_MS),
        ttl_ms: BROWSER_LOCK_TTL_MS,
    };
}
function inspectMcpGrant(now) {
    const data = readJsonFile(stepupFilePath(MCP_GRANT_BASE));
    if (!data)
        return { exists: false };
    const sid = typeof data.sid === 'string' ? data.sid : null;
    const grantedAt = typeof data.grantedAt === 'number' ? data.grantedAt : null;
    if (!sid || grantedAt === null)
        return { exists: false };
    return {
        exists: true,
        sid,
        granted_at_ms: grantedAt,
        age_ms: now - grantedAt,
        expired: now - grantedAt >= MCP_GRANT_TTL_MS,
        ttl_ms: MCP_GRANT_TTL_MS,
    };
}
function inspectMcpInflight(now) {
    const data = readJsonFile(stepupFilePath(MCP_INFLIGHT_BASE));
    if (!data)
        return { exists: false };
    const sid = typeof data.sid === 'string' ? data.sid : null;
    const startedAt = typeof data.startedAt === 'number' ? data.startedAt : null;
    if (!sid || startedAt === null)
        return { exists: false };
    const browserUrl = typeof data.browserUrl === 'string' ? data.browserUrl : '';
    const expiresAt = typeof data.expiresAt === 'string' ? data.expiresAt : undefined;
    return {
        exists: true,
        sid,
        browser_url: browserUrl,
        started_at_ms: startedAt,
        age_ms: now - startedAt,
        expired: isExpiredAt(startedAt, expiresAt, now),
        expires_at: expiresAt,
    };
}
export function inspectStepupState(now = Date.now()) {
    migrateLegacyFile(stepupFileName(VERIFIED_BASE), 'cache');
    migrateLegacyFile(stepupFileName(PENDING_BASE), 'cache');
    migrateLegacyFile(stepupFileName(BROWSER_LOCK_BASE), 'cache');
    return {
        cache_dir: cacheDir(),
        now_ms: now,
        verified: inspectVerified(now),
        pending: inspectPending(now),
        verified_fp: listFingerprints(VERIFIED_BASE)
            .map((fp) => inspectVerifiedFile(stepupFilePath(VERIFIED_BASE, fp), now, fp))
            .filter((v) => v.exists),
        pending_fp: listFingerprints(PENDING_BASE)
            .map((fp) => inspectPendingFile(stepupFilePath(PENDING_BASE, fp), now, fp))
            .filter((p) => p.exists),
        browser_lock: inspectBrowserLock(now),
        mcp_grant: inspectMcpGrant(now),
        mcp_inflight: inspectMcpInflight(now),
    };
}
//# sourceMappingURL=inspector.js.map