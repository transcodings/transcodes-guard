/**
 * OS-appropriate cache directory, re-exported for backwards compatibility.
 * New code in this package should call dataDir() directly.
 */
export declare function cacheDir(): string;
export type VerifiedStepup = {
    sid: string;
    verifiedAt: number;
};
export declare function readVerified(): VerifiedStepup | null;
export declare function writeVerified(v: VerifiedStepup): void;
export declare function consumeVerified(): void;
