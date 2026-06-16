/**
 * Public surface of @transcodes-guard/danger-patterns.
 *
 * Bash danger-pattern registry: regex matchers against Bash command strings,
 * plus the shared RBAC coordinate vocabulary (action/resource).
 */
export { findFirstMatch, loadMergedPatterns, loadSystemPatterns, } from './danger-patterns.js';
export { coerceRbacAction, coerceRbacResource, DEFAULT_RBAC_ACTION, DEFAULT_RBAC_RESOURCE, isRbacAction, RBAC_ACTIONS, } from './rbac.js';
//# sourceMappingURL=index.js.map