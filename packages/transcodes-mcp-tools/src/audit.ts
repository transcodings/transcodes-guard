/**
 * Audit-log MCP tool — ported from transcodes-mcp-server's `src/tools/audit.ts`.
 * Read-only; project is fixed by the TRANSCODES_TOKEN pid claim.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadStepupConfig } from '@transcodes-guard/stepup-core';
import { z } from 'zod';
import { execProtectedTool } from './stepup-helper.js';
import { req } from './transcodes-client.js';

export function registerAuditTools(server: McpServer): void {
  server.registerTool(
    'get_security_logs',
    {
      title: 'Get security logs',
      description:
        'List project audit logs with pagination and filters. Use for security investigations, login/admin activity review, compliance. Returns tag, severity, IP, user_agent, member_id, metadata. Filter by `tag`; `start_date`/`end_date` are ISO 8601 range filters. ' +
        'RBAC-gated via tool-rule `tc-get-security-logs` (system/read).',
      inputSchema: {
        page: z.number().optional(),
        limit: z.number().optional(),
        tag: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      },
    },
    async ({ page, limit, tag, start_date, end_date }) => {
      const config = loadStepupConfig();
      return execProtectedTool('get_security_logs', (sid) =>
        req(
          config,
          {
            method: 'GET',
            query: {
              project_id: config.projectId,
              page,
              limit,
              tag,
              start_date,
              end_date,
            },
            stepUpSid: sid,
          },
          'get_security_logs',
        ),
      );
    },
  );
}
