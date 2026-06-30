/**
 * Public surface of @transcodes-guard/danger-patterns.
 *
 * One danger-rule registry, two parallel matchers:
 * - Bash danger-pattern registry (danger-patterns.ts): regex matchers against
 *   Bash command strings.
 * - MCP tool-rule registry (tool-rules.ts): toolName ↔ stepup policy mappings.
 * Both share the RBAC coordinate vocabulary (action/resource) from rbac.ts.
 */
export { findFirstMatch, loadMergedPatterns, loadSystemPatterns, } from './danger-patterns.js';
export { coerceRbacAction, coerceRbacResource, DEFAULT_RBAC_ACTION, DEFAULT_RBAC_RESOURCE, isRbacAction, RBAC_ACTIONS, } from './rbac.js';
export { currentHostProvider, findFirstToolRule, GUARD_PROVIDERS, isMcpWireToolName, isTranscodesGuardWireToolName, loadMergedToolRules, loadSystemToolRules, mapHostToProvider, mcpConsumesInHook, mergeToolRuleChanges, ruleAppliesToHost, systemToolRuleIds, ToolRuleValidationError, toolNameMatchesRule, validateNewToolRule, } from './tool-rules.js';
//# sourceMappingURL=index.js.map