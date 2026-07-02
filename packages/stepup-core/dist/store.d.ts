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
export declare function readVerified(fp?: string): VerifiedStepup | null;
export declare function writeVerified(v: VerifiedStepup, fp?: string): void;
export declare function consumeVerified(fp?: string): void;
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
export declare function claimVerified(fp?: string): VerifiedStepup | null;
/**
 * List every FP-KEYED verified file currently on disk (excludes the GLOBAL
 * file). Best-effort: an unreadable cache dir yields an empty list so callers
 * (sweeps) never throw.
 */
export declare function listVerifiedFingerprints(): string[];
