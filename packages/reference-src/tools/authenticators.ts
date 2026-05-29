import type { ProxyTool } from './tool-utils.ts';
import { parse, req } from './tool-utils.ts';

/** WebAuthn authenticators (non-passkey flow) */
export const authenticatorsTools: ProxyTool[] = [
  {
    name: 'get_authenticator',
    description:
      'Get one WebAuthn authenticator by credential id. Project comes from TRANSCODES_TOKEN; requires member_id and id.',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string' },
        id: { type: 'string', description: 'credential id' },
      },
      required: ['member_id', 'id'],
    },
    handler: async (a, config) =>
      req(
        config,
        {
          method: 'GET',
          query: {
            project_id: config.projectId,
            member_id: parse.str(a, 'member_id'),
            id: parse.str(a, 'id'),
          },
        },
        'get_authenticator'
      ),
  },
  {
    name: 'list_authenticators',
    description:
      'List all WebAuthn authenticators for a member. Separate from the passkey service. Requires member_id.',
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
        'list_authenticators'
      ),
  },
];
