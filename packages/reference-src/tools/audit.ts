import type { ProxyTool } from './tool-utils.ts';
import { parse, req } from './tool-utils.ts';

/** Audit logs (AuditController). */
export const auditTools: ProxyTool[] = [
  {
    name: 'get_security_logs',
    description:
      'List project audit logs with pagination and filters. Use for security investigations, login/admin activity review, compliance. Returns tag, severity, IP, user_agent, member_id, metadata. Filter by `tag`; `start_date`/`end_date` are ISO 8601 range filters.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number' },
        limit: { type: 'number' },
        tag: { type: 'string' },
        start_date: { type: 'string', description: 'ISO 8601' },
        end_date: { type: 'string', description: 'ISO 8601' },
      },
      required: [],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'GET',
          query: {
            project_id: config.projectId,
            page: parse.num(a, 'page'),
            limit: parse.num(a, 'limit'),
            tag: parse.str(a, 'tag'),
            start_date: parse.str(a, 'start_date'),
            end_date: parse.str(a, 'end_date'),
          },
        },
        'get_security_logs'
      ),
  },
];
