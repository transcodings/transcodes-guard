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
 * `checkRbacPermission` returns `null` when the decision cannot be determined
 * (network/parse failure). `evaluateAction` instead returns a
 * `GuardEvaluateFailure` carrying the HTTP status + backend error text, so the
 * hook can surface WHY the gate failed (issue #189). Callers MUST fail-closed
 * either way — treat any failure as step-up required (2), never as allow.
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
 * Why `POST /guard/evaluate` could not produce a verdict.
 *  - `network`   — request never got an HTTP response (status 0; timeout/DNS/refused).
 *  - `http`      — backend answered non-2xx (status + backend error text preserved).
 *  - `malformed` — 2xx but the payload did not parse into a `GuardVerdict`.
 */
export type GuardEvaluateFailure = {
  ok: false;
  kind: 'network' | 'http' | 'malformed';
  status: number;
  /** Backend envelope `message`/`error` (+ `logId` for backend log correlation). */
  message?: string | undefined;
};

export type GuardEvaluateResult =
  | { ok: true; verdict: GuardVerdict }
  | GuardEvaluateFailure;

/**
 * The extracted text flows into the agent-facing deny message, and a hostile
 * or misbehaving intermediary (captive portal, corporate proxy) controls the
 * non-2xx body — so bound it: strip control characters and cap the length.
 */
const FAILURE_MESSAGE_MAX_LENGTH = 240;
function sanitizeFailureText(text: string): string {
  let flat = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    flat += code < 32 || code === 127 ? ' ' : ch;
  }
  flat = flat.replace(/ {2,}/g, ' ').trim();
  return flat.length > FAILURE_MESSAGE_MAX_LENGTH
    ? `${flat.slice(0, FAILURE_MESSAGE_MAX_LENGTH)}…`
    : flat;
}

/** Pull human-readable failure text out of the backend error envelope. */
function extractFailureMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const o = data as { message?: unknown; error?: unknown; logId?: unknown };
  const text =
    typeof o.message === 'string' && o.message.trim()
      ? o.message.trim()
      : Array.isArray(o.message) &&
          o.message.length > 0 &&
          o.message.every((m) => typeof m === 'string')
        ? o.message.join('; ')
        : typeof o.error === 'string' && o.error.trim()
          ? o.error.trim()
          : undefined;
  const logId = typeof o.logId === 'string' && o.logId ? o.logId : undefined;
  const combined =
    text && logId
      ? `${text}; logId=${logId}`
      : (text ?? (logId ? `logId=${logId}` : undefined));
  return combined ? sanitizeFailureText(combined) : undefined;
}

/**
 * POST /v1/guard/evaluate — one round-trip: backend classifies the raw hook
 * payload, applies the matrix, and (for level 2) creates or reuses the
 * member-scoped coordinate step-up session. Every tool call (except built-in
 * transcodes-guard MCP) reaches this path. On any failure returns a
 * `GuardEvaluateFailure` (never a verdict) → caller fails closed and surfaces
 * the failure detail in the deny message.
 */
export async function evaluateAction(
  config: StepupConfig,
  body: {
    payload: unknown;
    /** Wire tool name resolved from the host hook shape (plugin-side). */
    toolName?: string | undefined;
    cwd?: string | undefined;
    provider?: GuardProvider | undefined;
  },
): Promise<GuardEvaluateResult> {
  const env = await request(config, {
    method: 'POST',
    path: '/guard/evaluate',
    body: {
      payload: body.payload,
      tool_name: body.toolName,
      cwd: body.cwd,
      provider: body.provider,
    },
  });
  if (!env.ok) {
    return {
      ok: false,
      kind: env.status === 0 ? 'network' : 'http',
      status: env.status,
      message: extractFailureMessage(env.data),
    };
  }
  const malformed: GuardEvaluateFailure = {
    ok: false,
    kind: 'malformed',
    status: env.status,
  };
  const data = env.data as { payload?: unknown[] } | null;
  const p = (Array.isArray(data?.payload) ? data.payload[0] : null) as Record<
    string,
    unknown
  > | null;
  if (!p || typeof p !== 'object') return malformed;
  const { permission, resource, action } = p;
  if (permission !== 0 && permission !== 1 && permission !== 2)
    return malformed;
  if (typeof resource !== 'string' || typeof action !== 'string')
    return malformed;
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
    ok: true,
    verdict: {
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
    },
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
