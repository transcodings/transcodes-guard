/**
 * Tool-rule registry — MCP-call counterpart of danger-patterns.
 *
 * `danger-patterns.ts` matches Bash command strings via regex; this module
 * matches PreToolUse payloads where `tool_name` identifies an MCP tool that
 * must trigger step-up MFA. Two-layer source (system + user) and the
 * load/validate/CRUD surface mirror danger-patterns.ts deliberately so the
 * mental model is single.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { dataDir, migrateLegacyFile } from "@transcodes-guard/plugin-paths";
// System rules embedded at build time — see the matching note in
// danger-patterns.ts (bundlers inline this; a runtime path read breaks once the
// plugin is bundled by tsup).
import systemToolRulesData from "./data/tool-rules.json" with { type: "json" };

export interface ToolRule {
  id: string;
  /** Exact tool_name match. Regex is intentionally not supported — keeps the
   * gate's scope explicit and auditable. */
  toolName: string;
  reason: string;
  /** Backend audit-log action identifier (e.g. "retire_member"). */
  stepupAction: string;
  /** Backend audit-log resource identifier (e.g. "transcodes-guard:mcp:members"). */
  stepupResource: string;
  /** When true, the PreToolUse hook consumes the verified record itself on the
   * fast-path (Bash-like). When false, consume is deferred to the tool handler
   * via `withStepupVerifiedSid` (handler needs the sid for the backend header).
   * Defaults per source in `loadMergedToolRules`: system=false, user=true. */
  consume_in_hook?: boolean;
}

export interface ToolRuleConfig {
  rules: ToolRule[];
}

export type ToolRuleSource = "system" | "user";

export interface MergedToolRule extends ToolRule {
  source: ToolRuleSource;
}

const USER_TOOL_RULES_FILE = "user-tool-rules.json";

const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export function getUserToolRulesPath(): string {
  return path.join(dataDir(), USER_TOOL_RULES_FILE);
}

export function loadSystemToolRules(): ToolRuleConfig {
  // Embedded at build time — see the static import above. Fresh shape per call
  // so callers cannot mutate the shared embedded array.
  return { rules: [...(systemToolRulesData as ToolRuleConfig).rules] };
}

export function loadUserToolRules(): ToolRuleConfig {
  migrateLegacyFile(USER_TOOL_RULES_FILE, "data");
  try {
    const raw = readFileSync(getUserToolRulesPath(), "utf8");
    // JSONC parse: see loadUserPatterns for rationale.
    const parsed = parseJsonc(raw) as ToolRuleConfig | undefined;
    if (parsed && Array.isArray(parsed.rules)) {
      return parsed;
    }
    return { rules: [] };
  } catch {
    return { rules: [] };
  }
}

export function saveUserToolRules(config: ToolRuleConfig): void {
  const file = getUserToolRulesPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function userToolRulesFileExists(): boolean {
  return existsSync(getUserToolRulesPath());
}

export function loadMergedToolRules(): MergedToolRule[] {
  const system = loadSystemToolRules().rules.map((r) => ({
    ...r,
    consume_in_hook: r.consume_in_hook ?? false,
    source: "system" as const,
  }));
  const user = loadUserToolRules().rules.map((r) => ({
    ...r,
    consume_in_hook: r.consume_in_hook ?? true,
    source: "user" as const,
  }));
  return [...system, ...user];
}

export interface ToolRuleMatch {
  matched: MergedToolRule;
}

export function findFirstToolRule(
  toolName: string,
  rules: MergedToolRule[],
): ToolRuleMatch | null {
  for (const r of rules) {
    if (r.toolName === toolName) return { matched: r };
  }
  return null;
}

export class ToolRuleValidationError extends Error {}

export interface ToolRuleInput {
  id: string;
  toolName: string;
  reason: string;
  stepupAction: string;
  stepupResource: string;
  consume_in_hook?: boolean;
}

// Heuristic guard: a tool rule matches a tool_name exactly. A Bash COMMAND
// STRING (e.g. "rm -rf /", "git push") pasted in as a toolName is a mis-bucketed
// command pattern — it would never fire here because the hook matches tool rules
// against tool_name, not Bash commands. A valid MCP tool name is a single
// identifier (alnum + `_` `.` `:` `-`, with `__`/`:` namespacing). Anything with
// whitespace or shell metacharacters is a command, not a tool name.
function detectShellCommand(toolName: string): boolean {
  return /[\s|&;<>$*()`\\/]/.test(toolName);
}

export function validateNewToolRule(input: ToolRuleInput): ToolRule {
  const { id, toolName, reason, stepupAction, stepupResource, consume_in_hook } = input;

  if (!ID_REGEX.test(id)) {
    throw new ToolRuleValidationError(
      `id must match /^[a-z0-9][a-z0-9-]*$/ (got: "${id}")`,
    );
  }

  const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
  if (systemIds.has(id)) {
    throw new ToolRuleValidationError(
      `id "${id}" is reserved by a system tool-rule and cannot be overridden`,
    );
  }

  const trimmedToolName = toolName.trim();
  if (!trimmedToolName) {
    throw new ToolRuleValidationError("toolName must not be empty");
  }

  if (detectShellCommand(trimmedToolName)) {
    throw new ToolRuleValidationError(
      `"${trimmedToolName}" looks like a Bash command, not an MCP tool name. ` +
        `Tool rules match a tool_name exactly (e.g. mcp__github__delete_repository); ` +
        `they never match Bash commands. Use add_user_pattern (regex) instead.`,
    );
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new ToolRuleValidationError("reason must not be empty");
  }

  const trimmedAction = stepupAction.trim();
  if (!trimmedAction) {
    throw new ToolRuleValidationError("stepupAction must not be empty");
  }

  const trimmedResource = stepupResource.trim();
  if (!trimmedResource) {
    throw new ToolRuleValidationError("stepupResource must not be empty");
  }

  return {
    id,
    toolName: trimmedToolName,
    reason: trimmedReason,
    stepupAction: trimmedAction,
    stepupResource: trimmedResource,
    ...(consume_in_hook === undefined ? {} : { consume_in_hook }),
  };
}

export function addUserToolRule(input: ToolRuleInput): ToolRule {
  const rule = validateNewToolRule(input);
  const current = loadUserToolRules();
  if (current.rules.some((r) => r.id === rule.id)) {
    throw new ToolRuleValidationError(
      `id "${rule.id}" already exists in user tool-rules; use update instead`,
    );
  }
  current.rules.push(rule);
  saveUserToolRules(current);
  return rule;
}

export function updateUserToolRule(
  id: string,
  changes: {
    toolName?: string;
    reason?: string;
    stepupAction?: string;
    stepupResource?: string;
    consume_in_hook?: boolean;
  },
): ToolRule {
  const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
  if (systemIds.has(id)) {
    throw new ToolRuleValidationError(
      `id "${id}" is a system tool-rule and cannot be modified`,
    );
  }

  const current = loadUserToolRules();
  const existing = current.rules.find((r) => r.id === id);
  if (!existing) {
    throw new ToolRuleValidationError(`no user tool-rule with id "${id}"`);
  }

  const merged: ToolRuleInput = {
    id,
    toolName: changes.toolName ?? existing.toolName,
    reason: changes.reason ?? existing.reason,
    stepupAction: changes.stepupAction ?? existing.stepupAction,
    stepupResource: changes.stepupResource ?? existing.stepupResource,
    consume_in_hook: changes.consume_in_hook ?? existing.consume_in_hook,
  };
  const validated = validateNewToolRule(merged);

  const idx = current.rules.findIndex((r) => r.id === id);
  current.rules[idx] = validated;
  saveUserToolRules(current);
  return validated;
}

export function removeUserToolRule(id: string): void {
  const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
  if (systemIds.has(id)) {
    throw new ToolRuleValidationError(
      `id "${id}" is a system tool-rule and cannot be removed`,
    );
  }
  const current = loadUserToolRules();
  const idx = current.rules.findIndex((r) => r.id === id);
  if (idx === -1) {
    throw new ToolRuleValidationError(`no user tool-rule with id "${id}"`);
  }
  current.rules.splice(idx, 1);
  saveUserToolRules(current);
}
