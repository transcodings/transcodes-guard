import type { ProxyTool } from './tool-utils.ts';
import { parse, req } from './tool-utils.ts';

/** Passkeys */
export const passkeysTools: ProxyTool[] = [
  {
    name: 'list_passkeys',
    description:
      'List passkeys for a member. Server typically filters by project rp_id. Requires member_id.',
    inputSchema: {
      type: 'object',
      properties: { member_id: { type: 'string' } },
      required: ['member_id'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'GET',
          query: {
            project_id: config.projectId,
            member_id: parse.str(a, 'member_id'),
          },
        },
        'list_passkeys'
      ),
  },
];
