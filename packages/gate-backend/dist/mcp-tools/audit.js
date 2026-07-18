import { z } from 'zod';
import { defineProtectedBackendTool } from './define.js';
import { req } from './transcodes-client.js';
export const auditToolDefinitions = [
    defineProtectedBackendTool({
        name: 'tc_get_security_logs',
        title: 'Get security logs',
        description: 'List project audit logs with pagination and filters. Use for security investigations, login/admin activity review, compliance. Returns tag, severity, IP, user_agent, member_id, metadata. Filter by `tag`; `start_date`/`end_date` are ISO 8601 range filters. ' +
            'RBAC-gated via tool-rule `tc-get-security-logs` (system/read).',
        summary: 'Paginated project audit logs with tag and date filters.',
        category: 'Audit',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        stepUp: {
            action: 'read',
            resource: 'system',
        },
        inputSchema: {
            page: z.number().optional(),
            limit: z.number().optional(),
            tag: z.string().optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
        },
        run: (config, { page, limit, tag, start_date, end_date }) => req(config, {
            method: 'GET',
            query: {
                project_id: config.projectId,
                page,
                limit,
                tag,
                start_date,
                end_date,
            },
        }, 'get_security_logs'),
    }),
];
//# sourceMappingURL=audit.js.map