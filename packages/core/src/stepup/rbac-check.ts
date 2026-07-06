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

import { GUARD_PROVIDERS, type GuardProvider } from '../patterns/index.js';
import { request } from './client.js';
import type { StepupConfig } from './config.js';

export type RbacLevel = 0 | 1 | 2;

export type GuardStepUpStatus = 'pending' | 'verified' | 'rejected';

export type GuardVerdict = {
  permission: RbacLevel;
  resource: string;
  action: string;
  reasoning: string;
  summary: string;
  provider: GuardProvider | null;
  sid: string | null;
  url: string | null;
  expires_at: string | null;
  /**
   * Guard v3 grouping (from evaluate, sourced from step-up-session SSOT):
   *   exist  — evaluate reused an existing `step-up-session:{sid}`.
   *   status — live session status (poll via GET .../session/:sid).
   */
  exist: boolean;
  status: GuardStepUpStatus | null;
};

/**
 * POST /v1/guard/evaluate — one round-trip: backend classifies the raw hook
 * payload, applies the matrix, and (for level 2) creates or reuses the grouped
 * step-up session keyed on `sid`. Every tool call (except built-in
 * transcodes-guard MCP) reaches this path. Returns null on any failure →
 * caller fails closed.
 */
export async function evaluateAction(
  config: StepupConfig,
  body: {
    payload: unknown;
    /** Wire tool name resolved from the host hook shape (plugin-side). */
    toolName?: string;
    cwd?: string;
    provider?: GuardProvider;
    /** Client-minted per-prompt grouping id (`s_…`). */
    group?: string;
    /** `tc_stepup_…` from the local latch file — same field used for poll. */
    sid?: string;
  },
): Promise<GuardVerdict | null> {
  const env = await request(config, {
    method: 'POST',
    path: '/guard/evaluate',
    body: {
      payload: body.payload,
      tool_name: body.toolName,
      cwd: body.cwd,
      provider: body.provider,
      group: body.group,
      sid: body.sid,
    },
  });
  if (!env.ok) return null;
  const data = env.data as { payload?: unknown[] } | null;
  const p = (Array.isArray(data?.payload) ? data.payload[0] : null) as Record<
    string,
    unknown
  > | null;
  if (!p || typeof p !== 'object') return null;
  const { permission, resource, action } = p;
  if (permission !== 0 && permission !== 1 && permission !== 2) return null;
  if (typeof resource !== 'string' || typeof action !== 'string') return null;
  const status =
    p.status === 'pending' || p.status === 'verified' || p.status === 'rejected'
      ? p.status
      : null;
  const summary =
    typeof p.summary === 'string' && p.summary.trim() ? p.summary.trim() : '';
  const provider =
    typeof p.provider === 'string' &&
    (GUARD_PROVIDERS as readonly string[]).includes(p.provider)
      ? (p.provider as GuardProvider)
      : null;
  return {
    permission,
    resource,
    action,
    reasoning: typeof p.reasoning === 'string' ? p.reasoning : '',
    summary,
    provider,
    sid: typeof p.sid === 'string' ? p.sid : null,
    url: typeof p.url === 'string' ? p.url : null,
    expires_at: typeof p.expires_at === 'string' ? p.expires_at : null,
    exist: p.exist === true,
    status,
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
