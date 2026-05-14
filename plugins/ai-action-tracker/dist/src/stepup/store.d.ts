/**
 * OS-appropriate cache directory. Inlined instead of pulling env-paths
 * because the plugin distribution ships dist/ without node_modules.
 *
 *   linux   $XDG_CACHE_HOME or ~/.cache, suffix "ai-action-tracker"
 *   macOS   ~/Library/Caches/ai-action-tracker
 *   win32   %LOCALAPPDATA%\ai-action-tracker\Cache
 */
export declare function cacheDir(): string;
export type VerifiedStepup = {
    sid: string;
    verifiedAt: number;
};
export declare function readVerified(): VerifiedStepup | null;
export declare function writeVerified(v: VerifiedStepup): void;
export declare function consumeVerified(): void;
