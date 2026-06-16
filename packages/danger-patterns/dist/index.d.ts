/**
 * Public surface of @transcodes-guard/danger-patterns.
 *
 * Bash danger-pattern registry: regex matchers against Bash command strings,
 * plus the shared RBAC coordinate vocabulary (action/resource).
 */
export { type DangerConfig, type DangerPattern, findFirstMatch, loadMergedPatterns, loadSystemPatterns, type MatchResult, type MergedPattern, type PatternSource, } from './danger-patterns.js';
export { coerceRbacAction, coerceRbacResource, DEFAULT_RBAC_ACTION, DEFAULT_RBAC_RESOURCE, isRbacAction, RBAC_ACTIONS, type RbacAction, } from './rbac.js';
