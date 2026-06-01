/**
 * Console-only (blocked) tools — ported from transcodes-mcp-server's
 * `src/tools/organization.ts`.
 *
 * None of these call the backend. They are registered for *discoverability*:
 * when a user asks "what can I do?" or requests user/organization management
 * or per-member token issuance, the agent surfaces the capability and routes
 * the user to the Transcodes console instead of inventing an unsupported
 * action. For the protected console link, pair with `get_console_url`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { blockedResult } from './transcodes-client.js';

const MSG_PLATFORM_CONSOLE =
  'User and organization management must be done in the Transcodes console. This MCP tool does not call the API.';

const MSG_ORG_CONSOLE =
  'Organization settings, user invitations, and invitation management (send, update, cancel, accept, decline) must be done directly in the Transcodes console at https://transcodes.io. This MCP tool does not call the API.';

const MSG_MEMBER_TOKEN_CONSOLE =
  'Per-member MCP tokens (TRANSCODES_TOKEN — the JWT sent as the x-transcodes-token header) can only be issued from the Transcodes console at https://app.transcodes.io. ' +
  'This MCP tool does not call the API — open the console, sign in, and create or rotate the token from the member detail page; then store it in your MCP client config.';

export function registerOrganizationTools(server: McpServer): void {
  server.registerTool(
    'user_get_current',
    {
      title: 'Get current user (console-only)',
      description:
        'Blocked: current user profile must be managed in the Transcodes console / host app (Firebase Bearer).',
      inputSchema: {},
    },
    async () => blockedResult(MSG_PLATFORM_CONSOLE),
  );

  server.registerTool(
    'user_find',
    {
      title: 'Find user (console-only)',
      description:
        'Blocked: user lookup must be done in the Transcodes console.',
      inputSchema: {
        ids: z.string().optional().describe('comma-separated'),
        emails: z.string().optional().describe('comma-separated'),
      },
    },
    async () => blockedResult(MSG_PLATFORM_CONSOLE),
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

  server.registerTool(
    'user_patch',
    {
      title: 'Update user (console-only)',
      description:
        'Blocked: user updates must be done in the Transcodes console.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_PLATFORM_CONSOLE),
  );

  server.registerTool(
    'user_delete',
    {
      title: 'Delete user (console-only)',
      description:
        'Blocked: user deletion must be done in the Transcodes console.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_PLATFORM_CONSOLE),
  );

  server.registerTool(
    'organization_get',
    {
      title: 'Get organization (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_overview',
    {
      title: 'Organization overview (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_create',
    {
      title: 'Create organization (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_patch',
    {
      title: 'Update organization (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {
        organization_id: z.string(),
        body: z.record(z.string(), z.unknown()),
      },
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_delete',
    {
      title: 'Delete organization (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {
        organization_id: z.string(),
      },
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_invitation_accept',
    {
      title: 'Accept invitation (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_invitation_decline',
    {
      title: 'Decline invitation (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_get_collaborators',
    {
      title: 'Get collaborators (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {
        organization_id: z.string(),
      },
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_invite_collaborator',
    {
      title: 'Invite collaborator (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {
        organization_id: z.string(),
        body: z.record(z.string(), z.unknown()),
      },
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_resend_invitation',
    {
      title: 'Resend invitation (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {
        organization_id: z.string(),
        body: z.record(z.string(), z.unknown()),
      },
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'organization_leave_collaborator',
    {
      title: 'Leave organization (console-only)',
      description:
        'Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.',
      inputSchema: {
        organization_id: z.string(),
        body: z.record(z.string(), z.unknown()),
      },
    },
    async () => blockedResult(MSG_ORG_CONSOLE),
  );

  server.registerTool(
    'member_token_create',
    {
      title: 'Create member token (console-only)',
      description:
        'Blocked: issuing a per-member MCP token (TRANSCODES_TOKEN — the JWT used as x-transcodes-token) must be done in the Transcodes console only. ' +
        'Use this when the user asks to "create / issue / rotate / regenerate / get a new" member token, MCP token, x-transcodes-token, or member JWT. ' +
        'This MCP tool does not call the API — direct the user to the Transcodes console (https://transcodes.io) member detail page to mint the token, then have them paste it into their MCP client config.',
      inputSchema: {},
    },
    async () => blockedResult(MSG_MEMBER_TOKEN_CONSOLE),
  );
}
