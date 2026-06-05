import { z } from 'zod';
import { loadStepupConfig } from '@transcodes-guard/stepup-core';
import { req } from './transcodes-client.js';
import { execProtectedTool } from './stepup-helper.js';
export function registerPasscodeTools(server) {
    server.registerTool('passcode_create', {
        title: 'Create recovery passcode',
        description: 'Create a recovery passcode (CreatePasscodeDto in body). ' +
            'RBAC-gated via tool-rule `tc-passcode-create` (0=block, 1=allow, 2=step-up MFA). ' +
            'Use for onboarding, support, or admin provisioning.',
        inputSchema: {
            body: z.object({ member_id: z.string() }),
        },
    }, async ({ body }) => {
        const config = loadStepupConfig();
        return execProtectedTool('passcode_create', (sid) => req(config, {
            method: 'POST',
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
        }, 'passcode_create'));
    });
}
//# sourceMappingURL=passcode.js.map