/**
 * Platform user MCP tools.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadStepupConfig } from '@transcodes-guard/stepup-core';
import { z } from 'zod';
import { blockedResult, req } from './transcodes-client.js';

const MSG_PLATFORM_CONSOLE =
  'User creation must be done in the Transcodes console. This MCP tool does not call the API.';

const textResult = (text: string, isError = false) => ({
  isError,
  content: [{ type: 'text' as const, text }],
});

export function registerOrganizationTools(server: McpServer): void {
  server.registerTool(
    'user_get_current',
    {
      title: 'Get current user',
      description:
        'Returns the currently authenticated platform user (Firebase/console account). ' +
        'Use when the user asks "who am I" at the platform-user level (distinct from `get_my_profile`, which returns the member record for TRANSCODES_TOKEN).',
      inputSchema: {},
    },
    async () => {
      const config = loadStepupConfig();
      const text = await req(config, { method: 'GET' }, 'user_get_current');
      return textResult(text);
    },
  );

  server.registerTool(
    'user_find',
    {
      title: 'Find user',
      description:
        'Find platform users by comma-separated ids or emails. Pass `ids` and/or `emails`.',
      inputSchema: {
        ids: z.string().optional().describe('comma-separated user ids'),
        emails: z.string().optional().describe('comma-separated emails'),
      },
    },
    async ({ ids, emails }) => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        {
          method: 'GET',
          query: { ids, emails },
        },
        'user_find',
        '/find',
      );
      return textResult(text);
    },
  );

  server.registerTool(
    'user_create',
    {
      title: 'Create user (console-only)',
      description:
        'Blocked: user creation must be done in the Transcodes console.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_PLATFORM_CONSOLE),
  );
}
