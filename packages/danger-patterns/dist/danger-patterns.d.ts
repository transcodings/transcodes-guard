import { type RbacAction } from "./rbac.js";
export interface DangerPattern {
    id: string;
    regex: string;
    reason: string;
    /** RBAC resource key (e.g. "system"), validated against the live backend at
     * add time. Feeds `createStepupSession({ resource })`. Optional on disk for
     * back-compat; coerced to a default in `loadMergedPatterns`. */
    stepupResource?: string;
    /** RBAC CRUD action (create/read/update/delete). Feeds
     * `createStepupSession({ action })`. Optional on disk for back-compat. */
    stepupAction?: RbacAction;
}
export interface DangerConfig {
    patterns: DangerPattern[];
}
export type PatternSource = "system" | "user";
export interface MergedPattern extends DangerPattern {
    source: PatternSource;
    /** Always resolved (coerced from defaults) for the gate. */
    stepupResource: string;
    stepupAction: RbacAction;
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
    /** Must be a CRUD action (create/read/update/delete). */
    stepupAction: string;
    /** RBAC resource key. Backend existence is validated by the caller (MCP
     * handler) before this runs — this layer only enforces non-empty. */
    stepupResource: string;
}
export declare function validateNewPattern(input: PatternInput): DangerPattern;
export declare function addUserPattern(input: PatternInput): DangerPattern;
export declare function updateUserPattern(id: string, changes: {
    regex?: string;
    reason?: string;
    stepupAction?: string;
    stepupResource?: string;
}): DangerPattern;
export declare function removeUserPattern(id: string): void;
