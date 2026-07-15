/**
 * Public surface of @transcodes-guard/core/patterns.
 *
 * One danger-rule registry, two parallel matchers:
 * - Bash danger-pattern registry (core/patterns.ts): regex matchers against
 *   Bash command strings.
 * - MCP tool-rule registry (tool-rules.ts): toolName ↔ stepup policy mappings.
 * Both share the RBAC coordinate vocabulary (action/resource) from rbac.ts.
 */
export { findFirstMatch, loadMergedPatterns, loadSystemPatterns, } from './danger-patterns.js';
export { coerceRbacAction, coerceRbacResource, DEFAULT_RBAC_ACTION, DEFAULT_RBAC_RESOURCE, isRbacAction, RBAC_ACTIONS, } from './rbac.js';
export { builtinExemptEntries, currentHostProvider, findFirstToolRule, GUARD_PROVIDERS, GUARD_TOOL_NAMES, isBuiltinExemptToolName, isGuardToolName, isMcpWireToolName, loadMergedToolRules, loadSystemToolRules, mapHostToProvider, mcpConsumesInHook, mergeToolRuleChanges, ruleAppliesToHost, systemToolRuleIds, ToolRuleValidationError, TRANSCODES_GUARD_TOOL_PREFIX, toolNameMatchesRule, validateNewToolRule, } from './tool-rules.js';
//# sourceMappingURL=index.js.map