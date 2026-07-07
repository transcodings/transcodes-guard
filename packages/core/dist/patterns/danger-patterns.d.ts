import { type RbacAction } from './rbac.js';
export interface DangerPattern {
    id: string;
    regex: string;
    reason: string;
    stepupResource?: string;
    stepupAction?: RbacAction;
}
export interface DangerConfig {
    patterns: DangerPattern[];
}
/** Immutable built-in baseline, or project bash rule from the signed bundle. */
export type PatternSource = 'system' | 'bundle';
export interface MergedPattern extends DangerPattern {
    source: PatternSource;
    stepupResource: string;
    stepupAction: RbacAction;
}
export interface MatchResult {
    matched: MergedPattern;
}
export declare function loadSystemPatterns(): DangerConfig;
/** Built-in system patterns only — project bash rules come from the policy bundle. */
export declare function loadMergedPatterns(): MergedPattern[];
export declare function findFirstMatch(command: string, patterns: MergedPattern[]): MatchResult | null;
