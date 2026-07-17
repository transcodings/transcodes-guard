/**
 * Platform user MCP tools.
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
import { loadStepupConfig } from '@transcodes-guard/core/stepup';
import { z } from 'zod';
import { defineBackendTool, textResult } from './define.js';
import { blockedResult, req } from './transcodes-client.js';

const MSG_PLATFORM_CONSOLE =
  'User creation must be done in the Transcodes console. This MCP tool does not call the API.';

export const organizationToolDefinitions: readonly GuardToolDefinition[] = [
  defineBackendTool({
    name: 'tc_user_get_current',
    title: 'Get current user',
    description:
      'Returns the currently authenticated platform user (Firebase/console account). ' +
      'Use when the user asks "who am I" at the platform-user level (distinct from `get_my_profile`, which returns the member record for TRANSCODES_TOKEN).',
    summary:
      'Returns the currently authenticated platform user (Firebase/console account).',
    category: 'Platform users',
    access: 'api',
    mutating: false,
    meta: false,
    stepUpProtected: false,
    inputSchema: {},
    handler: async () => {
      const config = loadStepupConfig();
      const text = await req(config, { method: 'GET' }, 'user_get_current');
      return textResult(text);
    },
  }),

  defineBackendTool({
    name: 'tc_user_find',
    title: 'Find user',
    description:
      'Find platform users by comma-separated ids or emails. Pass `ids` and/or `emails`.',
    summary: 'Find platform users by comma-separated ids or emails.',
    category: 'Platform users',
    access: 'api',
    mutating: false,
    meta: false,
    stepUpProtected: false,
    inputSchema: {
      ids: z.string().optional().describe('comma-separated user ids'),
      emails: z.string().optional().describe('comma-separated emails'),
    },
    handler: async ({ ids, emails }) => {
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
  }),

  defineBackendTool({
    name: 'tc_user_create',
    title: 'Create user (console-only)',
    description:
      'Blocked: user creation must be done in the Transcodes console.',
    summary: 'User creation must be done in the Transcodes console.',
    category: 'Platform users',
    access: 'console-only',
    mutating: false,
    meta: false,
    stepUpProtected: false,
    inputSchema: {},
    handler: async () => blockedResult(MSG_PLATFORM_CONSOLE),
  }),
];
