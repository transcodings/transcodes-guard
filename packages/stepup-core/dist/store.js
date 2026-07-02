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
import { readFileSync, renameSync, rmSync } from 'node:fs';
import { migrateLegacyFile, cacheDir as pluginCacheDir, } from '@transcodes-guard/plugin-paths';
import { STEPUP_TTL_MS } from './config.js';
import { atomicWriteFile, listFingerprints, stepupFileName, stepupFilePath, } from './stepup-files.js';
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
/**
 * Validate the raw JSON of a verified record. Returns the record when it is a
 * well-formed, non-expired `{sid, verifiedAt}`; returns null on malformed or
 * expired input. Pure (no disk side effects) so both `readVerified` (which
 * self-consumes the on-disk file) and `claimVerified` (which already holds the
 * only copy) can reuse it. `fp` is used only for the expiry log line.
 */
function parseVerifiedRecord(raw, fp) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    const obj = parsed;
    const sid = typeof obj.sid === 'string' ? obj.sid : null;
    const verifiedAt = typeof obj.verifiedAt === 'number' ? obj.verifiedAt : null;
    if (!sid || verifiedAt === null) {
        return null;
    }
    const ageMs = Date.now() - verifiedAt;
    if (ageMs > STEPUP_TTL_MS) {
        // Signal the silent consume so agents/users notice that a previously
        // verified session lapsed mid-flow. Without this line the deny
        // appears identical to a never-verified deny and root-cause analysis
        // requires reading timestamps off disk.
        process.stderr.write(`transcodes-guard: verified record EXPIRED (sid=${sid}, age=${ageMs}ms, ttl=${STEPUP_TTL_MS}ms${fp ? `, fp=${fp}` : ''}) — starting a new step-up.\n`);
        return null;
    }
    return { sid, verifiedAt };
}
export function readVerified(fp) {
    // Only the GLOBAL file has a legacy location to migrate from.
    if (!fp)
        migrateLegacyFile(stepupFileName(FILE_BASE), 'cache');
    let raw;
    try {
        raw = readFileSync(storePath(fp), 'utf8');
    }
    catch {
        return null;
    }
    const record = parseVerifiedRecord(raw, fp);
    // Self-heal: a corrupt/expired record is consumed on read and reported absent.
    if (!record)
        consumeVerified(fp);
    return record;
}
export function writeVerified(v, fp) {
    atomicWriteFile(storePath(fp), JSON.stringify(v));
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
 * Atomically claim a verified record for exclusive use, returning it only to
 * the caller that wins the race. Renames `stepup-verified.<fp>.json` to a
 * pid-tagged sibling first (rename is atomic on POSIX, so exactly one of N
 * concurrent hooks succeeds), then reads + validates the claimed copy.
 *
 * The fast path in evaluate.ts re-polls the backend AFTER reading the record —
 * a network round-trip that widens the read→consume window to hundreds of ms.
 * Without an exclusive claim, two hooks for the same command both read the
 * record, both re-poll, both allow, and both consume — one MFA authorises two
 * executions. Claiming up front collapses that window: the loser gets null and
 * falls through to a fresh step-up.
 *
 * On any decision the claimed sibling is removed (the winner has the record in
 * memory; a discard restores nothing since the record is single-use). Returns
 * the validated record on win, `null` on loss or if the record is
 * absent/corrupt/expired.
 */
export function claimVerified(fp) {
    if (!fp)
        migrateLegacyFile(stepupFileName(FILE_BASE), 'cache');
    const file = storePath(fp);
    const claimed = `${file}.claimed.${process.pid}`;
    try {
        renameSync(file, claimed);
    }
    catch {
        // Lost the race (another hook renamed it first) or no record present.
        return null;
    }
    let record;
    try {
        record = parseVerifiedRecord(readFileSync(claimed, 'utf8'), fp);
    }
    catch {
        record = null;
    }
    try {
        rmSync(claimed, { force: true });
    }
    catch {
        // best-effort: the claim already succeeded, cleanup failure is harmless.
    }
    return record;
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