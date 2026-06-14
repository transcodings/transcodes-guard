/**
 * Backend write flows for guard tool-rules (Phase 3 v2).
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

function ruleToCreateBody(input: ToolRuleInput, rule: ToolRule) {
  return {
    rule_id: rule.id,
    type: rule.type,
    label: rule.label,
    description: rule.description,
    status: input.status ?? 'active',
    name: rule.name,
    matcher: rule.matcher,
    ...(rule.provider !== undefined ? { provider: rule.provider } : {}),
    ...(rule.action !== undefined ? { action: rule.action } : {}),
    ...(rule.resource !== undefined ? { resource: rule.resource } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };
}

function ruleToUpdateBody(
  merged: ToolRule,
  changes: ToolRuleChanges,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: merged.type,
    label: merged.label,
    description: merged.description,
    status: changes.status ?? 'active',
    name: merged.name,
    matcher: merged.matcher,
    ...(changes.metadata !== undefined ? { metadata: changes.metadata } : {}),
  };
  if (merged.action !== undefined) {
    body.action = merged.action;
  }
  if (merged.resource !== undefined) {
    body.resource = merged.resource;
  }
  if (merged.provider !== undefined) {
    body.provider = merged.provider;
  }
  return body;
}

export async function addToolRule(input: ToolRuleInput): Promise<ToolRule> {
  const config = requireConfig();
  const rule = validateNewToolRule(input);
  const env = await request(config, {
    method: 'POST',
    path: '/guard/rules',
    body: ruleToCreateBody(input, rule),
  });
  if (!env.ok) throw backendWriteError(env, rule.id, 'add');
  await refreshPolicyBundle(config, { force: true });
  return rule;
}

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
    body: ruleToUpdateBody(merged, changes),
  });
  if (!env.ok) throw backendWriteError(env, id, 'update');
  await refreshPolicyBundle(config, { force: true });
  return merged;
}

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
