export type VerifiedStepup = {
    sid: string;
    verifiedAt: number;
};
export declare function readVerified(): VerifiedStepup | null;
export declare function writeVerified(v: VerifiedStepup): void;
export declare function consumeVerified(): void;
