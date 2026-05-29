import type { ProxyTool } from './tool-utils.ts';
import { blocked, req } from './tool-utils.ts';

const MSG_PROJECT_PWA_AUTH_CONSOLE =
  'PWA and authentication configuration (manifest, service worker, widget, branding, WebAuthn, related origins, token expiry, etc.) must be performed in the Transcodes console. ' +
  'Changes to these settings require the project SDK to be rebuilt and redeployed — a process that the console handles automatically. ' +
  'Modifying them directly via API without going through the console build pipeline will leave the deployed SDK out of sync with your configuration. ' +
  'This MCP tool does not call the API.';

/**
 * `/v1/project/...`
 * - get_project:  GET /project/:project_id — 토큰의 pid 클레임으로 고정 (사용자 입력 X, 테넌시 우회 차단)
 * - get_projects: GET /project/organization/:organization_id — list an organization's projects
 * - PWA / authentication configuration changes are console-only (project_pwa_auth_console)
 */
export const projectTools: ProxyTool[] = [
  {
    name: 'get_project',
    description:
      'Fetch the active project (fixed by TRANSCODES_TOKEN pid claim). ' +
      'Returns all information about the project — including toolkit, pwa, domain_url, title, description, and created/updated timestamps. ' +
      'No arguments — project is determined by the token.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async (_a, config) =>
      req(config, { method: 'GET' }, 'get_project', `/${config.projectId}`),
  },

  {
    name: 'project_pwa_auth_console',
    description:
      'Blocked: PWA and authentication configuration (manifest, service worker, branding, WebAuthn, related origins, token expiry, etc.) must be done in the Transcodes console. ' +
      'These settings trigger an SDK rebuild and redeployment — a pipeline the console manages automatically. ' +
      'Applying changes directly via API skips that pipeline and leaves the live SDK out of sync with the new configuration.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_PROJECT_PWA_AUTH_CONSOLE),
  },
];
