/**
 * RBAC permission-matrix lookup for the PreToolUse gate.
 *
 * After a pattern/tool-rule matches and yields a (resource, action) coordinate,
 * the gate asks the backend what the project's RBAC matrix says for the token's
 * member: 0 = deny, 1 = allow (no step-up), 2 = allow + step-up. This makes the
 * RBAC matrix the single authority for the decision; the local rule only maps a
 * command/tool onto a coordinate.
 *
 * Backend route: POST /v1/auth/role/check-permission
 *   body  { member_id, resource, action, project_id }
 *   reply { data: { payload: [ { permission: 0|1|2, resource, action } ] } }
 *
 * Returns `null` when the decision cannot be determined (network/parse
 * failure). Callers MUST fail-closed — treat `null` as step-up required (2),
 * never as allow.
 */
import { request } from './client.js';
import type { StepupConfig } from './config.js';

export type RbacLevel = 0 | 1 | 2;

function extractPermission(
  data: unknown,
  resource: string,
  action: string,
): RbacLevel | null {
  if (!data || typeof data !== 'object') return null;
  const payload = (data as { payload?: unknown }).payload;
  if (!Array.isArray(payload)) return null;

  const match =
    payload.find(
      (p): p is { permission: number } =>
        !!p &&
        typeof p === 'object' &&
        (p as { resource?: unknown }).resource === resource &&
        (p as { action?: unknown }).action === action,
    ) ?? (payload[0] as { permission?: unknown } | undefined);

  const level = match?.permission;
  return level === 0 || level === 1 || level === 2 ? level : null;
}

export async function checkRbacPermission(
  config: StepupConfig,
  resource: string,
  action: string,
): Promise<RbacLevel | null> {
  const env = await request(config, {
    method: 'POST',
    path: '/auth/role/check-permission',
    body: {
      member_id: config.memberId,
      resource,
      action,
      project_id: config.projectId,
    },
  });
  if (!env.ok) return null;
  return extractPermission(env.data, resource, action);
}
