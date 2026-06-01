/**
 * Public surface of @transcodes-guard/danger-patterns.
 *
 * Bash danger-pattern registry: regex matchers against Bash command strings.
 *
 * Two-layer source (system + user) and the load/validate/CRUD surface mirror
 * @transcodes-guard-private/danger-rules deliberately so the mental model is
 * single. tool-rules (MCP tool-name registry) is the private sibling — it
 * carries Transcodes-specific protected tool mappings and ships separately.
 */

export {
  addUserPattern,
  type DangerConfig,
  type DangerPattern,
  findFirstMatch,
  getUserPatternsPath,
  loadMergedPatterns,
  loadSystemPatterns,
  loadUserPatterns,
  type MatchResult,
  type MergedPattern,
  type PatternInput,
  type PatternSource,
  PatternValidationError,
  removeUserPattern,
  saveUserPatterns,
  updateUserPattern,
  userPatternsFileExists,
  validateNewPattern,
} from './danger-patterns.js';
