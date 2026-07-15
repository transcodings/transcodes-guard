/**
 * Public surface of @transcodes-guard/core/patterns.
 *
 * One danger-rule registry, two parallel matchers:
 * - Bash danger-pattern registry (core/patterns.ts): regex matchers against
 *   Bash command strings.
 * - MCP tool-rule registry (tool-rules.ts): toolName ↔ stepup policy mappings.
 * Both share the RBAC coordinate vocabulary (action/resource) from rbac.ts.
 */
export { type DangerConfig, type DangerPattern, findFirstMatch, loadMergedPatterns, loadSystemPatterns, type MatchResult, type MergedPattern, type PatternSource, } from './danger-patterns.js';
export { coerceRbacAction, coerceRbacResource, DEFAULT_RBAC_ACTION, DEFAULT_RBAC_RESOURCE, isRbacAction, RBAC_ACTIONS, type RbacAction, } from './rbac.js';
export { type BuiltinExemptEntry, builtinExemptEntries, currentHostProvider, findFirstToolRule, GUARD_PROVIDERS, GUARD_TOOL_NAMES, type GuardMatcher, type GuardProvider, isBuiltinExemptToolName, isGuardToolName, isMcpWireToolName, loadMergedToolRules, loadSystemToolRules, type MergedToolRule, mapHostToProvider, mcpConsumesInHook, mergeToolRuleChanges, ruleAppliesToHost, systemToolRuleIds, type ToolRule, type ToolRuleChanges, type ToolRuleConfig, type ToolRuleInput, type ToolRuleMatch, type ToolRuleSource, ToolRuleValidationError, TRANSCODES_GUARD_TOOL_PREFIX, toolNameMatchesRule, validateNewToolRule, } from './tool-rules.js';
