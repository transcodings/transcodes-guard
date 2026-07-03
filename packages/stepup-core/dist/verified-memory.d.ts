/** Record a backend-verified sid for later single-shot consumption. */
export declare function markStepupVerified(sid: string, now?: number): void;
/** True when any non-expired verified sid is available (peek, no consume). */
export declare function hasStepupVerified(now?: number): boolean;
/**
 * Consume the most-recent non-expired verified sid, removing it. Returns null
 * when none is available. Expired entries are swept on access.
 */
export declare function claimStepupVerified(now?: number): string | null;
