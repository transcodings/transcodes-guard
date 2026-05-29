import type { ProxyTool } from './tool-utils.ts';
import { blocked } from './tool-utils.ts';

const MSG_PLATFORM_CONSOLE =
  'User and organization management must be done in the Transcodes console. This MCP tool does not call the API.';

const MSG_ORG_CONSOLE =
  'Organization settings, user invitations, and invitation management (send, update, cancel, accept, decline) must be done directly in the Transcodes console at https://transcodes.io. This MCP tool does not call the API.';

const MSG_MEMBER_TOKEN_CONSOLE =
  'Per-member MCP tokens (TRANSCODES_TOKEN — the JWT sent as the x-transcodes-token header can only be issued from the Transcodes console at https://app.transcodes.io. ' +
  'This MCP tool does not call the API — open the console, sign in, and create or rotate the token from the member detail page; then store it in your MCP client config.';

/**
 * Console-only (blocked) tools: user and organization management, plus per-member MCP token issuance.
 * Membership / Stripe proxy tools live in `membership.ts` — do not duplicate them here
 * (same tool name would overwrite the earlier registration in `tools/index.ts`).
 */
export const organizationTools: ProxyTool[] = [
  {
    name: 'user_get_current',
    description:
      'Blocked: current user profile must be managed in the Transcodes console / host app (Firebase Bearer).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_PLATFORM_CONSOLE),
  },
  {
    name: 'user_find',
    description: 'Blocked: user lookup must be done in the Transcodes console.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'string', description: 'comma-separated' },
        emails: { type: 'string', description: 'comma-separated' },
      },
    },
    handler: async () => blocked(MSG_PLATFORM_CONSOLE),
  },
  {
    name: 'user_create',
    description:
      'Blocked: user creation must be done in the Transcodes console.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_PLATFORM_CONSOLE),
  },
  {
    name: 'user_patch',
    description:
      'Blocked: user updates must be done in the Transcodes console.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_PLATFORM_CONSOLE),
  },
  {
    name: 'user_delete',
    description:
      'Blocked: user deletion must be done in the Transcodes console.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_PLATFORM_CONSOLE),
  },
  {
    name: 'organization_get',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_overview',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_create',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_patch',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: {
      type: 'object',
      properties: {
        organization_id: { type: 'string' },
        body: { type: 'object', additionalProperties: true },
      },
      required: ['organization_id', 'body'],
    },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_delete',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: {
      type: 'object',
      properties: { organization_id: { type: 'string' } },
      required: ['organization_id'],
    },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_invitation_accept',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_invitation_decline',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_get_collaborators',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: {
      type: 'object',
      properties: { organization_id: { type: 'string' } },
      required: ['organization_id'],
    },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_invite_collaborator',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: {
      type: 'object',
      properties: {
        organization_id: { type: 'string' },
        body: { type: 'object', additionalProperties: true },
      },
      required: ['organization_id', 'body'],
    },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_resend_invitation',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: {
      type: 'object',
      properties: {
        organization_id: { type: 'string' },
        body: { type: 'object', additionalProperties: true },
      },
      required: ['organization_id', 'body'],
    },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'organization_leave_collaborator',
    description:
      'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
    inputSchema: {
      type: 'object',
      properties: {
        organization_id: { type: 'string' },
        body: { type: 'object', additionalProperties: true },
      },
      required: ['organization_id', 'body'],
    },
    handler: async () => blocked(MSG_ORG_CONSOLE),
  },
  {
    name: 'member_token_create',
    description:
      'Blocked: issuing a per-member MCP token (TRANSCODES_TOKEN — the JWT used as x-transcodes-token must be done in the Transcodes console only. ' +
      'Use this when the user asks to "create / issue / rotate / regenerate / get a new" member token, MCP token, x-transcodes-token, or member JWT. ' +
      'This MCP tool does not call the API — direct the user to the Transcodes console (https://transcodes.io) member detail page to mint the token, then have them paste it into their MCP client config.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_MEMBER_TOKEN_CONSOLE),
  },
];
