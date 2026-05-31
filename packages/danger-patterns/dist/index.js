/**
 * Public surface of @transcodes-guard/danger-patterns.
 *
 * Two parallel registries the PreToolUse hook consults:
 *  - danger-patterns: regex matchers against Bash command strings
 *  - tool-rules:      exact-match registry for MCP tool names
 *
 * Both expose the same shape: load system rows shipped with the package,
 * load user rows from ~/.claude/ai-action-tracker/, merge with provenance,
 * find the first match, plus a strict CRUD surface for user-managed rows.
 * Hooks and the MCP server import from here; system data files live next
 * to this package under data/.
 */
export { PatternValidationError, getUserPatternsPath, loadSystemPatterns, loadUserPatterns, saveUserPatterns, userPatternsFileExists, loadMergedPatterns, findFirstMatch, validateNewPattern, addUserPattern, updateUserPattern, removeUserPattern, } from "./danger-patterns.js";
export { ToolRuleValidationError, getUserToolRulesPath, loadSystemToolRules, loadUserToolRules, saveUserToolRules, userToolRulesFileExists, loadMergedToolRules, findFirstToolRule, validateNewToolRule, addUserToolRule, updateUserToolRule, removeUserToolRule, } from "./tool-rules.js";
//# sourceMappingURL=index.js.map