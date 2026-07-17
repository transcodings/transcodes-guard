import { loadStepupConfig } from '@transcodes-guard/core/stepup';
import { z } from 'zod';
import { defineBackendTool, textResult } from './define.js';
import { req } from './transcodes-client.js';
export const authDeviceToolDefinitions = [
    defineBackendTool({
        name: 'tc_list_authenticators',
        title: 'List authenticators',
        description: 'List all WebAuthn authenticators for a member. Separate from the passkey service. Requires member_id.',
        summary: 'List WebAuthn authenticators for a member.',
        category: 'Auth Devices',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {
            member_id: z.string(),
        },
        handler: async ({ member_id }) => {
            const config = loadStepupConfig();
            const text = await req(config, {
                method: 'GET',
                query: { project_id: config.projectId, member_id },
            }, 'list_authenticators');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_list_passkeys',
        title: 'List passkeys',
        description: 'List passkeys for a member. Server typically filters by project rp_id. Requires member_id.',
        summary: 'List passkeys for a member.',
        category: 'Auth Devices',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {
            member_id: z.string(),
        },
        handler: async ({ member_id }) => {
            const config = loadStepupConfig();
            const text = await req(config, {
                method: 'GET',
                query: { project_id: config.projectId, member_id },
            }, 'list_passkeys');
            return textResult(text);
        },
    }),
    defineBackendTool({
        name: 'tc_list_totps',
        title: 'List TOTP devices',
        description: 'List TOTP devices for a member. Use to audit MFA enrollment. Requires member_id.',
        summary: 'List TOTP devices for a member.',
        category: 'Auth Devices',
        access: 'api',
        mutating: false,
        meta: false,
        stepUpProtected: false,
        inputSchema: {
            member_id: z.string(),
        },
        handler: async ({ member_id }) => {
            const config = loadStepupConfig();
            const text = await req(config, {
                method: 'GET',
                query: { project_id: config.projectId, member_id },
            }, 'list_totps');
            return textResult(text);
        },
    }),
];
//# sourceMappingURL=auth-devices.js.map