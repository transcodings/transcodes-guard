/**
 * Public surface of @transcodes-guard/danger-patterns.
 *
 * One danger-rule registry, two parallel matchers:
 * - Bash danger-pattern registry (danger-patterns.ts): regex matchers against
 *   Bash command strings.
 * - MCP tool-rule registry (tool-rules.ts): toolName ↔ stepup policy mappings.
 * Both share the RBAC coordinate vocabulary (action/resource) from rbac.ts.
 */

export {
  type DangerConfig,
  type DangerPattern,
  findFirstMatch,
  loadMergedPatterns,
  loadSystemPatterns,
  type MatchResult,
  type MergedPattern,
  type PatternSource,
} from './danger-patterns.js';
export {
  coerceRbacAction,
  coerceRbacResource,
  DEFAULT_RBAC_ACTION,
  DEFAULT_RBAC_RESOURCE,
  isRbacAction,
  RBAC_ACTIONS,
  type RbacAction,
} from './rbac.js';
export {
  currentHostProvider,
  findFirstToolRule,
  GUARD_PROVIDERS,
  type GuardMatcher,
  type GuardProvider,
  loadMergedToolRules,
  loadSystemToolRules,
  type MergedToolRule,
  mapHostToProvider,
  mcpConsumesInHook,
  mergeToolRuleChanges,
  ruleAppliesToHost,
  systemToolRuleIds,
  type ToolRule,
  type ToolRuleChanges,
  type ToolRuleConfig,
  type ToolRuleInput,
  type ToolRuleMatch,
  type ToolRuleSource,
  ToolRuleValidationError,
  toolNameMatchesRule,
  validateNewToolRule,
} from './tool-rules.js';
