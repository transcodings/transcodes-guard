/**
 * RBAC + optional step-up sid for protected MCP tool handlers.
 * Hook is first line; this re-checks on handler run (stdio/curl bypass backstop).
 * Matrix: 0=block, 1=pass (no sid), 2=step-up (verified sid required).
 */
import { loadMergedToolRules } from '@transcodes-guard/danger-patterns';
import {
  checkRbacPermission,
  clearPending,
  consumeVerified,
  loadStepupConfig,
  readVerified,
  type RbacLevel,
  type StepupConfig,
} from '@transcodes-guard/stepup-core';

const RBAC_TTL_MS = 5 * 60_000;
const rbacCache = new Map<string, { level: RbacLevel; exp: number }>();

async function getCachedRbacLevel(
  config: StepupConfig,
  resource: string,
  action: string,
): Promise<RbacLevel> {
  const key = `${config.memberId}:${resource}:${action}`;
  const hit = rbacCache.get(key);
  if (hit && Date.now() < hit.exp) return hit.level;
  const level = (await checkRbacPermission(config, resource, action)) ?? 2;
  rbacCache.set(key, { level, exp: Date.now() + RBAC_TTL_MS });
  return level;
}

export async function execProtectedTool(
  toolName: string,
  run: (sid: string | undefined) => Promise<string>
): Promise<{
  isError: boolean;
  content: { type: 'text'; text: string }[];
}> {
  const verified = readVerified();
  const rule = loadMergedToolRules().find(
    (r) => r.toolName === toolName || r.toolName.endsWith(`__${toolName}`)
  );

  if (rule) {
    let level: RbacLevel = 2;
    try {
      const config = loadStepupConfig();
      level = await getCachedRbacLevel(config, rule.stepupResource, rule.stepupAction);
    } catch {
      level = 2;
    }

    if (level === 0) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `transcodes-guard: BLOCKED (rbac-denied ${rule.stepupResource}/${rule.stepupAction}) — ${toolName}`,
          },
        ],
      };
    }

    if (level === 2 && !verified) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              `transcodes-guard: step-up MFA required (${rule.stepupResource}/${rule.stepupAction}) — ${toolName}. ` +
              'Complete WebAuthn (create_stepup_session → poll_stepup_session) or use the IDE MCP tool path.',
          },
        ],
      };
    }

    const sid = level === 2 ? verified?.sid : undefined;
    try {
      return {
        isError: false,
        content: [{ type: 'text', text: await run(sid) }],
      };
    } finally {
      if (level === 2 && verified) {
        consumeVerified();
        clearPending();
      }
    }
  }

  if (!verified) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `step-up verified record missing for ${toolName}`,
        },
      ],
    };
  }
  try {
    return {
      isError: false,
      content: [{ type: 'text', text: await run(verified.sid) }],
    };
  } finally {
    consumeVerified();
    clearPending();
  }
}
