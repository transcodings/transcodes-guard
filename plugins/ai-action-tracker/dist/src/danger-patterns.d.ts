export interface DangerPattern {
    id: string;
    regex: string;
    reason: string;
}
export interface DangerConfig {
    patterns: DangerPattern[];
}
export type PatternSource = "system" | "user";
export interface MergedPattern extends DangerPattern {
    source: PatternSource;
}
export declare function getUserPatternsPath(): string;
export declare function loadSystemPatterns(): DangerConfig;
export declare function loadUserPatterns(): DangerConfig;
export declare function saveUserPatterns(config: DangerConfig): void;
export declare function userPatternsFileExists(): boolean;
export declare function loadMergedPatterns(): MergedPattern[];
export interface MatchResult {
    matched: MergedPattern;
}
export declare function findFirstMatch(command: string, patterns: MergedPattern[]): MatchResult | null;
export declare class PatternValidationError extends Error {
}
export interface PatternInput {
    id: string;
    regex: string;
    reason: string;
}
export declare function validateNewPattern(input: PatternInput): DangerPattern;
export declare function addUserPattern(input: PatternInput): DangerPattern;
export declare function updateUserPattern(id: string, changes: {
    regex?: string;
    reason?: string;
}): DangerPattern;
export declare function removeUserPattern(id: string): void;
