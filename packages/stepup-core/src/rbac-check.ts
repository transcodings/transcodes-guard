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

export type GuardVerdict = {
  permission: RbacLevel;
  resource: string;
  action: string;
  reasoning: string;
  /** Where the verified sid is re-enforced. null when the backend omitted it. */
  consume_in_hook: boolean | null;
  sid: string | null;
  url: string | null;
  expires_at: string | null;
};

/**
 * POST /v1/guard/evaluate — one round-trip: backend classifies the raw
 * tool_input, applies the matrix, and (for level 2) creates the step-up
 * session. Every classified bash command and every external mcp__* wire name
 * reaches this path. Built-in transcodes-guard MCP skips the hook. Returns null
 * on any failure → caller fails closed.
 */
export async function evaluateAction(
  config: StepupConfig,
  body: {
    toolName?: string;
    toolInput: unknown;
    cwd?: string;
    comment?: string;
  },
): Promise<GuardVerdict | null> {
  const env = await request(config, {
    method: 'POST',
    path: '/guard/evaluate',
    body: {
      tool_name: body.toolName,
      tool_input: body.toolInput,
      cwd: body.cwd,
      comment: body.comment,
    },
  });
  if (!env.ok) return null;
  const data = env.data as { payload?: unknown[] } | null;
  const p = (
    Array.isArray(data?.payload) ? data.payload[0] : env.data
  ) as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return null;
  const { permission, resource, action } = p;
  if (permission !== 0 && permission !== 1 && permission !== 2) return null;
  if (typeof resource !== 'string' || typeof action !== 'string') return null;
  return {
    permission,
    resource,
    action,
    reasoning: typeof p.reasoning === 'string' ? p.reasoning : '',
    consume_in_hook:
      typeof p.consume_in_hook === 'boolean' ? p.consume_in_hook : null,
    sid: typeof p.sid === 'string' ? p.sid : null,
    url: typeof p.url === 'string' ? p.url : null,
    expires_at: typeof p.expires_at === 'string' ? p.expires_at : null,
  };
}

function extractPermission(
  data: unknown,
  resource: string,
  action: string,
): RbacLevel | null {
  if (!data || typeof data !== 'object') return null;
  const payload = (data as { payload?: unknown }).payload;
  if (!Array.isArray(payload)) return null;

  // Coordinate must match exactly. No payload[0] fallback: borrowing another
  // coordinate's permission would decide with the wrong row of the matrix.
  // The backend always echoes resource/action back (CheckRbacPermissionResponseDto),
  // so a mismatch means a malformed/foreign response → null → caller's
  // fail-closed `?? 2` (step-up forced). Phase3 v2 Unit H1.
  const match = payload.find(
    (p): p is { permission: number } =>
      !!p &&
      typeof p === 'object' &&
      (p as { resource?: unknown }).resource === resource &&
      (p as { action?: unknown }).action === action,
  );

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
