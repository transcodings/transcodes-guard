import type { ProxyTool } from './tool-utils.ts';
import { blocked } from './tool-utils.ts';

const MSG_JWK_BACKUP_CONSOLE =
  'JWK backup (encrypted download of member metadata, registered authentication methods, and audit logs) must be done in the Transcodes console. This MCP tool does not call the API.';

/** JWK backup — not callable via API; must be performed in the Transcodes console. */
export const jwkTools: ProxyTool[] = [
  {
    name: 'jwk_backup',
    description:
      'Blocked: JWK backup must be performed in the Transcodes console only. That flow yields an encrypted backup bundle that can include member metadata, authentication methods, and audit logs — not exposed through MCP.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => blocked(MSG_JWK_BACKUP_CONSOLE),
  },
];
