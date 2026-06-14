/**
 * Backend write flows for guard tool-rules (Phase 3 v2).
 */
import { mergeToolRuleChanges, systemToolRuleIds, ToolRuleValidationError, validateNewToolRule, } from '@transcodes-guard/danger-rules';
import { request } from './client.js';
import { loadStepupConfig } from './config.js';
import { readCachedPolicyBundle, refreshPolicyBundle, } from './policy-bundle.js';
function requireConfig() {
    try {
        return loadStepupConfig();
    }
    catch {
        throw new ToolRuleValidationError('No Transcodes token configured — tool-rules are managed in the backend and require a project token.');
    }
}
function extractBackendError(data) {
    if (data && typeof data === 'object' && 'error' in data) {
        const e = data.error;
        if (typeof e === 'string' && e.length > 0)
            return e;
    }
    return undefined;
}
function backendWriteError(env, id, op) {
    if (env.status === 409) {
        return new ToolRuleValidationError(`tool-rule "${id}" already exists`);
    }
    if (env.status === 404) {
        return new ToolRuleValidationError(`no tool-rule with id "${id}"`);
    }
    const detail = env.status === 0
        ? 'backend unreachable'
        : (extractBackendError(env.data) ?? `backend responded ${env.status}`);
    return new ToolRuleValidationError(`could not ${op} tool-rule: ${detail}`);
}
function ruleToCreateBody(input, rule) {
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
function ruleToUpdateBody(merged, changes) {
    const body = {
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
export async function addToolRule(input) {
    const config = requireConfig();
    const rule = validateNewToolRule(input);
    const env = await request(config, {
        method: 'POST',
        path: '/guard/rules',
        body: ruleToCreateBody(input, rule),
    });
    if (!env.ok)
        throw backendWriteError(env, rule.id, 'add');
    await refreshPolicyBundle(config, { force: true });
    return rule;
}
export async function updateToolRule(id, changes) {
    const config = requireConfig();
    if (systemToolRuleIds().has(id)) {
        throw new ToolRuleValidationError(`id "${id}" is a system tool-rule and cannot be modified`);
    }
    const existing = readCachedPolicyBundle(config.projectId)?.bundle.rules.find((r) => r.id === id);
    if (!existing) {
        throw new ToolRuleValidationError(`no tool-rule with id "${id}"`);
    }
    const merged = mergeToolRuleChanges(existing, changes);
    const env = await request(config, {
        method: 'PUT',
        path: `/guard/rules/${encodeURIComponent(id)}`,
        body: ruleToUpdateBody(merged, changes),
    });
    if (!env.ok)
        throw backendWriteError(env, id, 'update');
    await refreshPolicyBundle(config, { force: true });
    return merged;
}
export async function removeToolRule(id) {
    const config = requireConfig();
    if (systemToolRuleIds().has(id)) {
        throw new ToolRuleValidationError(`id "${id}" is a system tool-rule and cannot be removed`);
    }
    const env = await request(config, {
        method: 'DELETE',
        path: `/guard/rules/${encodeURIComponent(id)}`,
        omitBody: true,
    });
    if (!env.ok)
        throw backendWriteError(env, id, 'remove');
    await refreshPolicyBundle(config, { force: true });
}
//# sourceMappingURL=guard-rules.js.map