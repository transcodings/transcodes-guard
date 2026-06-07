/**
 * Public surface of @transcodes-guard/danger-patterns.
 *
 * Bash danger-pattern registry: regex matchers against Bash command strings,
 * plus the shared RBAC coordinate vocabulary (action/resource) that both this
 * package and the private @transcodes-guard-private/danger-rules sibling map
 * their rows onto. tool-rules (MCP tool-name registry) is the private sibling.
 */
export { addUserPattern, type DangerConfig, type DangerPattern, findFirstMatch, getUserPatternsPath, loadMergedPatterns, loadSystemPatterns, loadUserPatterns, type MatchResult, type MergedPattern, type PatternInput, type PatternSource, PatternValidationError, removeUserPattern, saveUserPatterns, updateUserPattern, userPatternsFileExists, validateNewPattern, } from './danger-patterns.js';
export { coerceRbacAction, coerceRbacResource, DEFAULT_RBAC_ACTION, DEFAULT_RBAC_RESOURCE, isRbacAction, RBAC_ACTIONS, type RbacAction, } from './rbac.js';
