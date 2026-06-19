/**
 * Tool-rule registry — MCP-call counterpart of the Bash pattern registry in
 * danger-patterns.ts. Both live in @transcodes-guard/danger-patterns and
 * share the RBAC coordinate vocabulary from rbac.ts.
 *
 * Phase 3 v2: rules mirror the backend guard bundle wire shape (`id`, `type`,
 * `label`, `description`, `name`, `matcher`, optional `action`/`resource`).
 */
import systemToolRulesData from './data/tool-rules.json' with { type: 'json' };
import {
  coerceRbacAction,
  coerceRbacResource,
  isRbacAction,
  type RbacAction,
} from './rbac.js';

export type GuardMatcher = 'exact' | 'glob' | 'regex';

export const GUARD_PROVIDERS = [
  'claude',
  'codex',
  'cursor',
  'antigravity',
] as const;

export type GuardProvider = (typeof GUARD_PROVIDERS)[number];

export interface ToolRule {
  id: string;
  type: 'mcp' | 'bash';
  label: string;
  description: string;
  /** MCP wire name/glob, or Bash regex when `type` is `bash`. */
  name: string;
  matcher: GuardMatcher;
  /** Optional MCP host label — stored for future use; does not affect matching today. */
  provider?: GuardProvider;
  /** Step-up RBAC verb — omitted when the rule only gates tool access. */
  action?: RbacAction;
  /** Step-up resource key — omitted when the rule only gates tool access. */
  resource?: string;
  /**
   * When true, the hook consumes the verified record (FP-keyed, single-shot).
   * When false, the MCP tool handler passes sid via X-Step-Up-Session-Id.
   * Default: `true` for bundle (project) rules, `false` for system rules.
   */
  consume_in_hook?: boolean;
}

export interface ToolRuleConfig {
  rules: ToolRule[];
}

export type ToolRuleSource = 'system' | 'bundle';

export interface MergedToolRule extends ToolRule {
  source: ToolRuleSource;
}

const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export function loadSystemToolRules(): ToolRuleConfig {
  return { rules: [...(systemToolRulesData as ToolRuleConfig).rules] };
}

function normalizeRule(r: ToolRule): ToolRule {
  if (r.type === 'bash') {
    return {
      ...r,
      type: 'bash',
      matcher: 'regex',
      action: coerceRbacAction(r.action),
      resource: coerceRbacResource(r.resource),
    };
  }
  return {
    ...r,
    type: 'mcp',
    matcher: r.matcher ?? 'exact',
    ...(r.provider !== undefined ? { provider: r.provider } : {}),
    ...(r.action !== undefined ? { action: coerceRbacAction(r.action) } : {}),
    ...(r.resource !== undefined
      ? { resource: coerceRbacResource(r.resource) }
      : {}),
  };
}

/**
 * Layered merge: built-in baseline → org/project policy bundle.
 * Same `id` in a later layer replaces the earlier rule.
 */
export function loadMergedToolRules(
  bundleRules: ToolRule[] = [],
): MergedToolRule[] {
  const merged = new Map<string, MergedToolRule>();
  for (const r of loadSystemToolRules().rules) {
    merged.set(r.id, { ...normalizeRule(r), source: 'system' });
  }
  for (const r of bundleRules) {
    merged.set(r.id, { ...normalizeRule(r), source: 'bundle' });
  }
  return [...merged.values()];
}

export interface ToolRuleMatch {
  matched: MergedToolRule;
}

function globMatches(pattern: string, toolName: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(toolName);
}

export function toolNameMatchesRule(toolName: string, rule: ToolRule): boolean {
  if (rule.type === 'bash') return false;
  // Case-insensitive: hosts emit wire names with mixed case
  // (e.g. mcp__claude_ai_Google_Calendar__create_event) while stored rule
  // names may differ in casing. Normalize both sides so matching is robust.
  const target = toolName.toLowerCase();
  const name = rule.name.toLowerCase();
  return rule.matcher === 'glob' ? globMatches(name, target) : name === target;
}

export function findFirstToolRule(
  toolName: string,
  rules: MergedToolRule[],
): ToolRuleMatch | null {
  for (const r of rules) {
    if (toolNameMatchesRule(toolName, r)) return { matched: r };
  }
  return null;
}

/** Whether PreToolUse should consume the verified record for this MCP rule. */
export function mcpConsumesInHook(rule: MergedToolRule): boolean {
  if (rule.consume_in_hook !== undefined) return rule.consume_in_hook;
  // Project rules (add_tool_rule / policy bundle) → FP-keyed hook path.
  // Built-in system rules → GLOBAL; handler needs sid for the backend header.
  return rule.source === 'bundle';
}

export class ToolRuleValidationError extends Error {}

export interface ToolRuleInput {
  id: string;
  type?: 'mcp' | 'bash';
  label: string;
  description: string;
  name: string;
  matcher?: GuardMatcher;
  provider?: GuardProvider;
  action?: string;
  resource?: string;
  status?: 'active' | 'inactive';
  metadata?: Record<string, unknown>;
}

/** Partial change set for an existing tool-rule (PUT semantics). */
export interface ToolRuleChanges {
  type?: 'mcp' | 'bash';
  label?: string;
  description?: string;
  name?: string;
  matcher?: GuardMatcher;
  provider?: GuardProvider;
  action?: string;
  resource?: string;
  status?: 'active' | 'inactive';
  metadata?: Record<string, unknown>;
}

function detectShellCommand(name: string): boolean {
  return /[\s|&;<>$*()`\\/]/.test(name);
}

function isGuardProvider(v: string): v is GuardProvider {
  return (GUARD_PROVIDERS as readonly string[]).includes(v);
}

export function validateNewToolRule(input: ToolRuleInput): ToolRule {
  const {
    id,
    type = 'mcp',
    label,
    description,
    name,
    matcher = type === 'bash' ? 'regex' : 'exact',
    provider,
    action,
    resource,
  } = input;

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

  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new ToolRuleValidationError('label must not be empty');
  }

  const trimmedDescription = description.trim();
  if (!trimmedDescription) {
    throw new ToolRuleValidationError('description must not be empty');
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new ToolRuleValidationError('name must not be empty');
  }

  if (type === 'bash') {
    if (matcher !== 'regex') {
      throw new ToolRuleValidationError('bash rules require matcher "regex"');
    }
    try {
      new RegExp(trimmedName);
    } catch (e) {
      throw new ToolRuleValidationError(
        `name must be a valid regex: ${(e as Error).message}`,
      );
    }
    const trimmedAction = (action ?? '').trim();
    if (!isRbacAction(trimmedAction)) {
      throw new ToolRuleValidationError(
        `action must be one of create|read|update|delete (got: "${action ?? ''}")`,
      );
    }
    const trimmedResource = (resource ?? '').trim();
    if (!trimmedResource) {
      throw new ToolRuleValidationError('resource must not be empty');
    }
    return {
      id,
      type: 'bash',
      label: trimmedLabel,
      description: trimmedDescription,
      name: trimmedName,
      matcher: 'regex',
      action: trimmedAction,
      resource: trimmedResource,
    };
  }

  if (type !== 'mcp') {
    throw new ToolRuleValidationError('type must be "mcp" or "bash"');
  }

  if (detectShellCommand(trimmedName)) {
    throw new ToolRuleValidationError(
      `"${trimmedName}" looks like a Bash command, not an MCP tool name. ` +
        'Tool rules match a tool_name exactly or via glob; use add_user_pattern (type bash) for Bash.',
    );
  }

  if (matcher !== 'exact' && matcher !== 'glob') {
    throw new ToolRuleValidationError(
      'mcp rules require matcher exact or glob',
    );
  }

  if (provider !== undefined) {
    const trimmedProvider = provider.trim();
    if (!isGuardProvider(trimmedProvider)) {
      throw new ToolRuleValidationError(
        `provider must be one of ${GUARD_PROVIDERS.join('|')} (got: "${provider}")`,
      );
    }
  }

  const rule: ToolRule = {
    id,
    type: 'mcp',
    label: trimmedLabel,
    description: trimmedDescription,
    name: trimmedName,
    matcher,
    ...(provider !== undefined
      ? { provider: provider.trim() as GuardProvider }
      : {}),
  };

  if (action !== undefined) {
    const trimmedAction = action.trim();
    if (!isRbacAction(trimmedAction)) {
      throw new ToolRuleValidationError(
        `action must be one of create|read|update|delete (got: "${action}")`,
      );
    }
    rule.action = trimmedAction;
  }

  if (resource !== undefined) {
    const trimmedResource = resource.trim();
    if (!trimmedResource) {
      throw new ToolRuleValidationError('resource must not be empty');
    }
    rule.resource = trimmedResource;
  }

  return rule;
}

export function mergeToolRuleChanges(
  existing: ToolRule,
  changes: ToolRuleChanges,
): ToolRule {
  return validateNewToolRule({
    id: existing.id,
    type: changes.type ?? existing.type,
    label: changes.label ?? existing.label,
    description: changes.description ?? existing.description,
    name: changes.name ?? existing.name,
    matcher: changes.matcher ?? existing.matcher,
    provider: changes.provider ?? existing.provider,
    action:
      changes.action ??
      (existing.action !== undefined
        ? coerceRbacAction(existing.action)
        : undefined),
    resource:
      changes.resource ??
      (existing.resource !== undefined
        ? coerceRbacResource(existing.resource)
        : undefined),
  });
}

export function systemToolRuleIds(): Set<string> {
  return new Set(loadSystemToolRules().rules.map((r) => r.id));
}
