/**
 * Backend write flows for guard tool-rules (Phase 3 v2).
 *
 * Tool-rules are organization/project policy managed in the Transcodes backend
 * (Unit G, endpoint B-2: `POST/PUT/DELETE /v1/guard/rules`). The MCP write
 * tools (`add_tool_rule`/`update_tool_rule`/`remove_tool_rule`) and the CLI
 * dashboard route through here instead of a local file: validate client-side,
 * call the backend CRUD, then force-refresh the policy bundle cache so the
 * change is effective on the next PreToolUse hook.
 *
 * The per-user local rule file was retired — rules are now centrally managed
 * policy applied uniformly to every human/AI agent in the project. No token /
 * backend failure surfaces as `ToolRuleValidationError` so the MCP handlers and
 * the dashboard report a clean rejection (there is no local fallback).
 */
import {
  mergeToolRuleChanges,
  systemToolRuleIds,
  type ToolRule,
  type ToolRuleChanges,
  type ToolRuleInput,
  ToolRuleValidationError,
  validateNewToolRule,
} from '@transcodes-guard/danger-rules';
import { type Envelope, request } from './client.js';
import { loadStepupConfig, type StepupConfig } from './config.js';
import {
  readCachedPolicyBundle,
  refreshPolicyBundle,
} from './policy-bundle.js';

/** Resolve the project token config or reject with a user-facing message. */
function requireConfig(): StepupConfig {
  try {
    return loadStepupConfig();
  } catch {
    throw new ToolRuleValidationError(
      'No Transcodes token configured — tool-rules are managed in the backend and require a project token.',
    );
  }
}

function extractBackendError(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'error' in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === 'string' && e.length > 0) return e;
  }
  return undefined;
}

/** Map a non-ok backend envelope to a user-facing `ToolRuleValidationError`. */
function backendWriteError(
  env: Envelope,
  id: string,
  op: 'add' | 'update' | 'remove',
): ToolRuleValidationError {
  if (env.status === 409) {
    return new ToolRuleValidationError(`tool-rule "${id}" already exists`);
  }
  if (env.status === 404) {
    return new ToolRuleValidationError(`no tool-rule with id "${id}"`);
  }
  const detail =
    env.status === 0
      ? 'backend unreachable'
      : (extractBackendError(env.data) ?? `backend responded ${env.status}`);
  return new ToolRuleValidationError(`could not ${op} tool-rule: ${detail}`);
}

/**
 * Create a project tool-rule. Validates client-side (id/toolName/coordinate +
 * system-id reservation) before the round-trip; the backend re-validates.
 */
export async function addToolRule(input: ToolRuleInput): Promise<ToolRule> {
  const config = requireConfig();
  const rule = validateNewToolRule(input);
  // Preserve the pre-migration user-rule default: for an arbitrary MCP tool the
  // hook must consume the verified record itself (no transcodes handler threads
  // the sid), so default consume_in_hook=true when the caller omits it.
  const consume_in_hook = rule.consume_in_hook ?? true;
  const env = await request(config, {
    method: 'POST',
    path: '/guard/rules',
    body: {
      rule_id: rule.id,
      tool_name: rule.toolName,
      reason: rule.reason,
      stepup_action: rule.stepupAction,
      stepup_resource: rule.stepupResource,
      consume_in_hook,
    },
  });
  if (!env.ok) throw backendWriteError(env, rule.id, 'add');
  await refreshPolicyBundle(config, { force: true });
  return { ...rule, consume_in_hook };
}

/**
 * Update a project tool-rule (PUT = full replace). Partial `changes` are merged
 * onto the rule's current state read from the cached bundle, so an unspecified
 * field keeps its stored value. System rules are immutable.
 */
export async function updateToolRule(
  id: string,
  changes: ToolRuleChanges,
): Promise<ToolRule> {
  const config = requireConfig();
  if (systemToolRuleIds().has(id)) {
    throw new ToolRuleValidationError(
      `id "${id}" is a system tool-rule and cannot be modified`,
    );
  }
  const existing = readCachedPolicyBundle(config.projectId)?.bundle.rules.find(
    (r) => r.id === id,
  );
  if (!existing) {
    throw new ToolRuleValidationError(`no tool-rule with id "${id}"`);
  }
  const merged = mergeToolRuleChanges(existing, changes);
  const env = await request(config, {
    method: 'PUT',
    path: `/guard/rules/${encodeURIComponent(id)}`,
    body: {
      tool_name: merged.toolName,
      reason: merged.reason,
      stepup_action: merged.stepupAction,
      stepup_resource: merged.stepupResource,
      ...(merged.consume_in_hook === undefined
        ? {}
        : { consume_in_hook: merged.consume_in_hook }),
    },
  });
  if (!env.ok) throw backendWriteError(env, id, 'update');
  await refreshPolicyBundle(config, { force: true });
  return merged;
}

/** Delete a project tool-rule. System rules are immutable. */
export async function removeToolRule(id: string): Promise<void> {
  const config = requireConfig();
  if (systemToolRuleIds().has(id)) {
    throw new ToolRuleValidationError(
      `id "${id}" is a system tool-rule and cannot be removed`,
    );
  }
  const env = await request(config, {
    method: 'DELETE',
    path: `/guard/rules/${encodeURIComponent(id)}`,
    omitBody: true,
  });
  if (!env.ok) throw backendWriteError(env, id, 'remove');
  await refreshPolicyBundle(config, { force: true });
}
