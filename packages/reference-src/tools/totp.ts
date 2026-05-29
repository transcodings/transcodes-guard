import type { ProxyTool } from './tool-utils.ts';
import { parse, req } from './tool-utils.ts';

/** TOTP MFA */
export const totpTools: ProxyTool[] = [
  {
    name: 'list_totps',
    description:
      'List TOTP devices for a member. Use to audit MFA enrollment. Requires member_id.',
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
        'list_totps'
      ),
  },
];
