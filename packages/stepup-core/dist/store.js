/**
 * Cross-process verified-stepup state file(s).
 *
 * Single-shot policy: every danger command requires a fresh MFA. The hook
 * writes a record on verify, the consumer (the hook itself, immediately
 * after) deletes it. TTL (`STEPUP_TTL_MS`) is enforced on read as a
 * defence against stale files left behind by abnormal exits.
 *
 * Two storage flavours (see `.claude/rules/stepup-gate.md`):
 *   - GLOBAL  `stepup-verified.json`            — the legacy single-record
 *     file. Used by the MCP **system-rule** path where the tool handler (a
 *     separate process from the hook) consumes via `withStepupVerifiedSid`
 *     and cannot reconstruct the command fingerprint. Backend replay
 *     protection is the backstop against parallel reuse here.
 *   - FP-KEYED `stepup-verified.<fp>.json`      — content-addressed by the
 *     command fingerprint. Used by the **hook-consume** path (Bash + user
 *     tool-rules, `consume_in_hook=true`). Each danger command gets its own
 *     pass token so parallel sub-agents cannot pick up each other's verified
 *     record (no ambient authority, no cross-contamination).
 *
 * `fp` arg convention across this module: `undefined` → GLOBAL file;
 * a 16-hex string → that fp's FP-KEYED file.
 *
 * Storage location is host-aware (see @transcodes-guard/plugin-paths):
 *   claude-code + CLAUDE_PLUGIN_DATA set → $CLAUDE_PLUGIN_DATA/
 *   any other host or env unset          → ~/.cache/ai-action-tracker/
 *
 * A one-shot migration moves the legacy GLOBAL file the first time
 * readVerified() runs after the upgrade. FP-KEYED files are new and need no
 * migration.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cacheDir as pluginCacheDir, migrateLegacyFile, } from '@transcodes-guard/plugin-paths';
import { STEPUP_TTL_MS } from './config.js';
import { listFingerprints, stepupDir, stepupFileName, stepupFilePath, } from './stepup-files.js';
/**
 * Cache directory re-exported for backwards compatibility.
 *
 * Returns $CLAUDE_PLUGIN_DATA when running under Claude Code with that
 * env set, else the OS-appropriate legacy cache dir. Stepup state files
 * intentionally use the cache flavour (not dataDir) so the non-claude-code
 * hosts (Codex/Antigravity/Cursor) keep their pre-existing
 * ~/.cache/ai-action-tracker/ path. Only Claude Code with env set diverges.
 */
export function cacheDir() {
    return pluginCacheDir();
}
/** File-name stem for verified records; the GLOBAL/FP-KEYED naming, scan, and
 * path mechanics live in stepup-files.ts. */
const FILE_BASE = 'stepup-verified';
function storePath(fp) {
    return stepupFilePath(FILE_BASE, fp);
}
/**
 * Read the verified record for `fp` (or the GLOBAL file when fp is omitted).
 * Self-healing: a corrupt, malformed, or expired record is consumed on read
 * and reported as absent.
 */
export function readVerified(fp) {
    // Only the GLOBAL file has a legacy location to migrate from.
    if (!fp)
        migrateLegacyFile(stepupFileName(FILE_BASE), 'cache');
    const file = storePath(fp);
    let raw;
    try {
        raw = readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        consumeVerified(fp);
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        consumeVerified(fp);
        return null;
    }
    const obj = parsed;
    const sid = typeof obj.sid === 'string' ? obj.sid : null;
    const verifiedAt = typeof obj.verifiedAt === 'number' ? obj.verifiedAt : null;
    if (!sid || verifiedAt === null) {
        consumeVerified(fp);
        return null;
    }
    const ageMs = Date.now() - verifiedAt;
    if (ageMs > STEPUP_TTL_MS) {
        // Signal the silent consume so agents/users notice that a previously
        // verified session lapsed mid-flow. Without this line the deny
        // appears identical to a never-verified deny and root-cause analysis
        // requires reading timestamps off disk.
        process.stderr.write(`transcodes-guard: verified record EXPIRED (sid=${sid}, age=${ageMs}ms, ttl=${STEPUP_TTL_MS}ms${fp ? `, fp=${fp}` : ''}) — starting a new step-up.\n`);
        consumeVerified(fp);
        return null;
    }
    return { sid, verifiedAt };
}
export function writeVerified(v, fp) {
    const file = storePath(fp);
    mkdirSync(stepupDir(), { recursive: true });
    writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
}
export function consumeVerified(fp) {
    try {
        rmSync(storePath(fp), { force: true });
    }
    catch {
        // best-effort cleanup
    }
}
/**
 * List every FP-KEYED verified file currently on disk (excludes the GLOBAL
 * file). Best-effort: an unreadable cache dir yields an empty list so callers
 * (sweeps) never throw.
 */
export function listVerifiedFingerprints() {
    return listFingerprints(FILE_BASE);
}
//# sourceMappingURL=store.js.map