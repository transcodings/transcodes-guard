/**
 * Public surface of @transcodes-guard/danger-patterns.
 *
 * Bash danger-pattern registry: regex matchers against Bash command strings,
 * plus the shared RBAC coordinate vocabulary (action/resource) that both this
 * package and the private @transcodes-guard/danger-rules sibling map
 * their rows onto. tool-rules (MCP tool-name registry) is the private sibling.
 */
export { addUserPattern, findFirstMatch, getUserPatternsPath, loadMergedPatterns, loadSystemPatterns, loadUserPatterns, PatternValidationError, removeUserPattern, saveUserPatterns, updateUserPattern, userPatternsFileExists, validateNewPattern, } from './danger-patterns.js';
export { coerceRbacAction, coerceRbacResource, DEFAULT_RBAC_ACTION, DEFAULT_RBAC_RESOURCE, isRbacAction, RBAC_ACTIONS, } from './rbac.js';
//# sourceMappingURL=index.js.map