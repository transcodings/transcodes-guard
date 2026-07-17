import { defineBackendTool } from './define.js';
import { blockedResult } from './transcodes-client.js';
const MSG_JWK_BACKUP_CONSOLE = 'JWK backup (encrypted download of member metadata, registered authentication methods, and audit logs) must be done in the Transcodes console. This MCP tool does not call the API.';
export const jwkToolDefinitions = [
    defineBackendTool({
        name: 'tc_jwk_backup',
        title: 'JWK backup (console-only)',
        description: 'Blocked: JWK backup must be performed in the Transcodes console only. That flow yields an encrypted backup bundle that can include member metadata, authentication methods, and audit logs — not exposed through MCP.',
        summary: 'JWK backup must be done in the Transcodes console.',
        category: 'JWK',
        access: 'console-only',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {},
        handler: async () => blockedResult(MSG_JWK_BACKUP_CONSOLE),
    }),
];
//# sourceMappingURL=jwk.js.map