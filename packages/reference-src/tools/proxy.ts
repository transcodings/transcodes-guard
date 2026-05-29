import type { ProxyTool } from './tool-utils.ts';
import { getConsoleUrl, req } from './tool-utils.ts';

export const proxyTools: ProxyTool[] = [
  {
    name: 'start_tunnel',
    description:
      'Starts a local HTTP MCP server (Streamable HTTP) on a random free port and returns http://localhost:<port>/mcp. ' +
      'Use this for clients that speak MCP over HTTP on the same machine; public tunnels are not started here.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (_args, config) => {
      const port = 0; // 0 = OS assigns a random free port
      try {
        const { startHttpServer } = await import('../http-server.ts');
        const actualPort = await startHttpServer(port, config);
        return JSON.stringify(
          {
            ok: true,
            url: `http://localhost:${actualPort}/mcp`,
          },
          null,
          2
        );
      } catch (err) {
        return JSON.stringify(
          {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          },
          null,
          2
        );
      }
    },
  },
  {
    name: 'stop_tunnel',
    description: 'Stops the local HTTP MCP server if it is running.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const { stopHttpServer, getHttpServerStatus } = await import(
        '../http-server.ts'
      );
      if (!('url' in getHttpServerStatus())) {
        return JSON.stringify({ ok: true, message: 'Not running.' }, null, 2);
      }
      stopHttpServer();
      return JSON.stringify({ ok: true, message: 'Stopped.' }, null, 2);
    },
  },
  {
    name: 'get_tunnel_status',
    description:
      'Returns whether the local HTTP MCP server is running and its http://localhost URL if so.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const { getHttpServerStatus } = await import('../http-server.ts');
      return JSON.stringify({ ok: true, ...getHttpServerStatus() }, null, 2);
    },
  },
  {
    name: 'get_current_project_id',
    description:
      'Returns the active project ID parsed from TRANSCODES_TOKEN. ' +
      'Call this tool first when you need the project ID instead of asking the user.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, config) =>
      JSON.stringify({ ok: true, project_id: config.projectId }, null, 2),
  },

  {
    name: 'get_current_organization_id',
    description: 'Returns organizationId from TRANSCODES_TOKEN JWT.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, config) =>
      JSON.stringify(
        { ok: true, organization_id: config.organizationId },
        null,
        2
      ),
  },

  {
    name: 'get_current_member_id',
    description: 'Returns memberId from TRANSCODES_TOKEN JWT.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, config) =>
      JSON.stringify({ ok: true, member_id: config.memberId }, null, 2),
  },

  {
    name: 'get_my_profile',
    description:
      'Returns the profile of the member identified by TRANSCODES_TOKEN (organizationId, projectId, memberId in config). ' +
      'Use when the user asks "who am I", "show my profile", or "show my member info". ' +
      'No arguments needed.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, config) =>
      req(
        config,
        {
          method: 'GET',
          query: { project_id: config.projectId, member_id: config.memberId },
        },
        'get_member'
      ),
  },

  {
    name: 'get_console_url',
    description:
      'Returns the project console URL (domain_url?tc_mode=console). ' +
      'Use when the user needs to perform browser-only actions: ' +
      'passkey register/update/revoke, authenticator register/update/revoke, ' +
      'TOTP enroll/update/revoke, OTP flows, JWK backup, or subscription portal (cancel, payment method, invoices). ' +
      'Direct the user to visit the returned URL and complete the action there.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, config) => {
      const url = await getConsoleUrl(config, config.projectId);
      return JSON.stringify(
        {
          ok: true,
          console_url: url ?? null,
          message: url
            ? 'Direct the user to this URL to complete the browser-only action.'
            : 'Console URL could not be resolved. Check get_project for domain_url.',
        },
        null,
        2,
      );
    },
  },
];
