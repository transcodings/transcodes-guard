/**
 * Recovery passcode MCP tool — ported from transcodes-mcp-server's
 * `src/tools/passcode.ts`.
 *
 * Protected: declares its step-up coordinate via `stepUp`; enforcement is
 * backend-owned (StepUpSessionGuard + coordinate verified cache).
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
import { z } from 'zod';
import { defineProtectedBackendTool } from './define.js';
import { req } from './transcodes-client.js';

export const passcodeToolDefinitions: readonly GuardToolDefinition[] = [
  defineProtectedBackendTool({
    name: 'tc_passcode_create',
    title: 'Create recovery passcode',
    description:
      'Create a recovery passcode (CreatePasscodeDto in body). ' +
      'RBAC-gated via tool-rule `tc-passcode-create` (0=block, 1=allow, 2=step-up MFA). ' +
      'Use for onboarding, support, or admin provisioning.',
    summary: 'Create a recovery passcode for a member (support/onboarding).',
    category: 'Passcode',
    access: 'api',
    mutating: true,
    meta: false,
    stepUpProtected: true,
    stepUp: {
      action: 'create',
      resource: 'system',
    },
    inputSchema: {
      body: z.object({ member_id: z.string() }),
    },
    run: (config, { body }) =>
      req(
        config,
        {
          method: 'POST',
          body: { ...body, project_id: config.projectId },
        },
        'passcode_create',
      ),
  }),
];
