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
function unwrapPayloadArray(data) {
    if (Array.isArray(data))
        return data;
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
        const payload = data.payload;
        if (Array.isArray(payload))
            return payload;
    }
    return [];
}
function parseGuardRuleRecord(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const r = raw;
    const id = typeof r.id === 'string' ? r.id : '';
    const type = r.type === 'mcp' || r.type === 'bash' ? r.type : null;
    const label = typeof r.label === 'string' ? r.label : '';
    const description = typeof r.description === 'string' ? r.description : '';
    const name = typeof r.name === 'string' ? r.name : '';
    const matcher = r.matcher === 'exact' || r.matcher === 'glob' || r.matcher === 'regex'
        ? r.matcher
        : type === 'bash'
            ? 'regex'
            : 'exact';
    const status = r.status === 'active' || r.status === 'inactive' ? r.status : null;
    if (!id || !type || !label || !description || !name || !status)
        return null;
    const record = {
        id,
        type,
        label,
        description,
        name,
        matcher,
        status,
    };
    if (typeof r.action === 'string')
        record.action = r.action;
    if (typeof r.resource === 'string')
        record.resource = r.resource;
    if (r.provider === 'claude' ||
        r.provider === 'codex' ||
        r.provider === 'cursor' ||
        r.provider === 'antigravity') {
        record.provider = r.provider;
    }
    if (typeof r.memberId === 'string')
        record.memberId = r.memberId;
    if (typeof r.createdAt === 'string')
        record.createdAt = r.createdAt;
    if (typeof r.updatedAt === 'string')
        record.updatedAt = r.updatedAt;
    if (r.metadata !== undefined && r.metadata !== null && typeof r.metadata === 'object') {
        record.metadata = r.metadata;
    }
    return record;
}
/** List every project guard rule (active + inactive) from the backend. */
export async function listGuardRules() {
    const config = requireConfig();
    const env = await request(config, {
        method: 'GET',
        path: '/guard/rules',
    });
    if (!env.ok) {
        throw backendWriteError(env, '', 'list');
    }
    return unwrapPayloadArray(env.data)
        .map(parseGuardRuleRecord)
        .filter((r) => r !== null);
}
async function findProjectRule(config, id) {
    if (systemToolRuleIds().has(id))
        return undefined;
    const cached = readCachedPolicyBundle(config.projectId)?.bundle.rules.find((r) => r.id === id);
    if (cached) {
        return {
            ...cached,
            type: cached.type,
            status: 'active',
        };
    }
    return (await listGuardRules()).find((r) => r.id === id);
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
    const existing = await findProjectRule(config, id);
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