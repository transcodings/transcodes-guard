import { loadStepupConfig } from '@transcodes-guard-private/stepup-core';
import { z } from 'zod';
import { RbacCoordinateError, resolveRuleRbacCoordinate, } from './rbac-validate.js';
import { req } from './transcodes-client.js';
const textResult = (text, isError = false) => ({
    isError,
    content: [{ type: 'text', text }],
});
const ruleMatcherSchema = z.enum(['exact', 'glob', 'regex']);
const ruleMcpPayloadSchema = z.object({
    server: z.string(),
    tool: z.string(),
    matcher: ruleMatcherSchema,
});
const ruleBashPayloadSchema = z.object({
    pattern: z.string(),
    matcher: ruleMatcherSchema,
});
export function registerRuleTools(server) {
    server.registerTool('list_rules', {
        title: 'List member rules',
        description: 'List MCP tool or bash rules for the member identified by TRANSCODES_TOKEN. ' +
            'Optional filters: `type` (`mcp` | `bash`), `status` (backend rule status, e.g. pending). ' +
            'Returns id, label, description, resource, action, mcp/bash match payload, metadata, timestamps.',
        inputSchema: {
            type: z.enum(['mcp', 'bash']).optional(),
            status: z.string().optional(),
        },
    }, async ({ type, status }) => {
        const config = loadStepupConfig();
        const text = await req(config, {
            method: 'GET',
            query: {
                project_id: config.projectId,
                member_id: config.memberId,
                type,
                status,
            },
        }, 'list_rules');
        return textResult(text);
    });
    server.registerTool('get_rule', {
        title: 'Get rule by id',
        description: 'Fetch one member MCP or bash rule by `rule_id` for the TRANSCODES_TOKEN member. ' +
            'Use after `list_rules` when you need full detail for a single rule.',
        inputSchema: {
            rule_id: z.string(),
        },
    }, async ({ rule_id }) => {
        const config = loadStepupConfig();
        const text = await req(config, {
            method: 'GET',
            query: {
                project_id: config.projectId,
                member_id: config.memberId,
            },
        }, 'get_rule', `/${rule_id}`);
        return textResult(text);
    });
    server.registerTool('create_rule', {
        title: 'Create member rule',
        description: 'Create an MCP tool rule (`type=mcp`) or bash rule (`type=bash`) for the TRANSCODES_TOKEN member. ' +
            '`type=mcp` requires `mcp` { server, tool, matcher }; `type=bash` requires `bash` { pattern, matcher }. ' +
            'RBAC coordinate: pass explicit `resource` (from `get_resources`) and `action` (create|read|update|delete). ' +
            '"Any resource" / "Any action" wildcards are rejected. When omitted, both default to `none` (not the first dropdown option). Returns the created rule.',
        inputSchema: {
            type: z.enum(['mcp', 'bash']),
            label: z.string(),
            description: z.string().optional(),
            status: z.string().optional(),
            resource: z.string().optional(),
            action: z.enum(['create', 'read', 'update', 'delete']).optional(),
            mcp: ruleMcpPayloadSchema.optional(),
            bash: ruleBashPayloadSchema.optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        },
    }, async ({ type, label, description, status, resource, action, mcp, bash, metadata, }) => {
        const config = loadStepupConfig();
        try {
            const rbac = await resolveRuleRbacCoordinate(config, resource, action);
            const text = await req(config, {
                method: 'POST',
                body: {
                    project_id: config.projectId,
                    member_id: config.memberId,
                    type,
                    label,
                    description,
                    status,
                    resource: rbac.resource,
                    action: rbac.action,
                    mcp,
                    bash,
                    metadata,
                },
            }, 'create_rule');
            return textResult(text);
        }
        catch (e) {
            if (e instanceof RbacCoordinateError) {
                return textResult(`Rejected: ${e.message}`, true);
            }
            throw e;
        }
    });
}
//# sourceMappingURL=rule.js.map