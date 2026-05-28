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
export declare function readVerified(): VerifiedStepup | null;
export declare function writeVerified(v: VerifiedStepup): void;
export declare function consumeVerified(): void;
