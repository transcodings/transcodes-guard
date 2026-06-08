/**
 * Recovery passcode MCP tool — ported from transcodes-mcp-server's
 * `src/tools/passcode.ts`.
 *
 * Step-up enforcement is via the PreToolUse hook (tool-rule
 * `tc-passcode-create`); this handler only threads the verified sid.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadStepupConfig } from '@transcodes-guard-private/stepup-core';
import { z } from 'zod';
import { execProtectedTool } from './stepup-helper.js';
import { req } from './transcodes-client.js';

export function registerPasscodeTools(server: McpServer): void {
  server.registerTool(
    'passcode_create',
    {
      title: 'Create recovery passcode',
      description:
        'Create a recovery passcode (CreatePasscodeDto in body). ' +
        'RBAC-gated via tool-rule `tc-passcode-create` (0=block, 1=allow, 2=step-up MFA). ' +
        'Use for onboarding, support, or admin provisioning.',
      inputSchema: {
        body: z.object({ member_id: z.string() }),
      },
    },
    async ({ body }) => {
      const config = loadStepupConfig();
      return execProtectedTool('passcode_create', (sid) =>
        req(
          config,
          {
            method: 'POST',
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
          },
          'passcode_create',
        ),
      );
    },
  );
}
