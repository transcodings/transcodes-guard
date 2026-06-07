/**
 * Cache directory re-exported for backwards compatibility.
 *
 * Returns $CLAUDE_PLUGIN_DATA when running under Claude Code with that
 * env set, else the OS-appropriate legacy cache dir. Stepup state files
 * intentionally use the cache flavour (not dataDir) so the non-claude-code
 * hosts (Codex/Antigravity/Cursor) keep their pre-existing
 * ~/.cache/ai-action-tracker/ path. Only Claude Code with env set diverges.
 */
export declare function cacheDir(): string;
export type VerifiedStepup = {
    sid: string;
    verifiedAt: number;
};
/**
 * Read the verified record for `fp` (or the GLOBAL file when fp is omitted).
 * Self-healing: a corrupt, malformed, or expired record is consumed on read
 * and reported as absent.
 */
export declare function readVerified(fp?: string): VerifiedStepup | null;
export declare function writeVerified(v: VerifiedStepup, fp?: string): void;
export declare function consumeVerified(fp?: string): void;
/**
 * List every FP-KEYED verified file currently on disk (excludes the GLOBAL
 * file). Best-effort: an unreadable cache dir yields an empty list so callers
 * (sweeps) never throw.
 */
export declare function listVerifiedFingerprints(): string[];
