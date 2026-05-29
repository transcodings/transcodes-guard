/**
 * Shared MCP tool utilities: argument parsing, backend proxy (req), and schema fragments.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { STEPUP_TTL_MS, type ProxyConfig } from '../config.ts';
import { request, type RequestInput } from '../client.ts';

/** MCP tool definition with handler */
export interface ProxyTool extends Tool {
  handler: (
    args: Record<string, unknown>,
    config: ProxyConfig
  ) => Promise<string>;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Shared copy for request-body descriptions (Nest DTOs still expect `project_id` in JSON).
 * Query parameters use `config.projectId` only — MCP tool args do not accept `project_id`.
 */
export const PROJECT_ID_GUIDANCE =
  'project_id in the body must be the TRANSCODES_TOKEN project id (pid claim); it is not configurable per tool call.';

/** Extracts optional fields from callTool arguments. */
export const parse = {
  /** Normalises MCP arguments to a plain record (guards against arrays and null). */
  record(v: unknown): Record<string, unknown> {
    if (isPlainRecord(v)) return v;
    return {};
  },

  /** Optional numeric query param (e.g. page, limit). */
  num(a: Record<string, unknown>, key: string): number | undefined {
    const v = a[key];
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  },

  /** Optional string query param. */
  str(a: Record<string, unknown>, key: string): string | undefined {
    const v = a[key];
    return typeof v === 'string' ? v : undefined;
  },
};

/**
 * Returns whether step-up MFA is still valid. If not verified, returns a blocked JSON string; if verified, null.
 * Call before sensitive tool handlers (retire_*, suspend_member, unsuspend_member, passcode_create, etc.).
 */
export function requireStepup(config: ProxyConfig): string | null {
  const v = config.verifiedStepup;
  if (!v) {
    return JSON.stringify(
      {
        ok: false,
        blocked: true,
        message:
          'Step-up MFA required. Call create_stepup_session first (comment: one short sentence for the step-up UI), ' +
          'send the user the auth URL, then poll_stepup_session after they confirm',
      },
      null,
      2
    );
  }
  if (Date.now() - v.verifiedAt > STEPUP_TTL_MS) {
    config.verifiedStepup = undefined;
    return JSON.stringify(
      {
        ok: false,
        blocked: true,
        message:
          'Step-up session has expired. Call create_stepup_session again',
      },
      null,
      2
    );
  }
  return null;
}

/** Returns a rejected response for actions that must be performed on the site or console. */
export function blocked(message: string): Promise<string> {
  return Promise.resolve(
    JSON.stringify({ ok: false, blocked: true, message }, null, 2)
  );
}

function blockedJson(message: string): string {
  return JSON.stringify({ ok: false, blocked: true, message }, null, 2);
}

/** Error codes that indicate a plan limit has been reached. */
const PLAN_LIMIT_ERROR_CODES = new Set([
  'ROLE_LIMIT_REACHED',
  'RESOURCE_LIMIT_REACHED',
  'MEMBER_LIMIT_REACHED',
  'PROJECT_LIMIT_REACHED',
]);

const UPGRADE_HINT =
  'Would you like to upgrade your plan? Use the membership_create_checkout_session tool to instantly generate a Stripe Checkout link for the Standard plan.';

/**
 * Resolves the final URL from the endpoint map (see src/constants.ts → DEFAULT_ENDPOINT_MAP) + optional pathSuffix and makes the request.
 * Full URL: `${apiBaseV1}${base}${pathSuffix}` (see client.ts — path is after `/v1`).
 *
 * Sensitive tools (each handler calls `requireStepup` first and clears `verifiedStepup` on completion):
 *   retire_member, suspend_member, unsuspend_member, update_member_role,
 *   retire_role, set_role_permissions, retire_resource, passcode_create.
 *
 * Appends an upgradeHint field when the response is a 403 plan-limit error.
 */
export async function req(
  config: ProxyConfig,
  input: Omit<RequestInput, 'path'>,
  toolName: string,
  pathSuffix?: string
): Promise<string> {
  const map = config.endpointMap;
  const base = map.get(toolName);
  if (!base) {
    return blockedJson(
      `Tool '${toolName}' is not enabled. Add it to DEFAULT_ENDPOINT_MAP in src/constants.ts and rebuild.`
    );
  }
  // '*' 는 백엔드 호출 없이 클라이언트 측에서 처리되는 built-in tool 마커.
  // 이런 tool 은 자체 핸들러에서 직접 로직을 수행해야 하며 req() 로 들어오면 안 됨.
  // defense-in-depth: 미래에 실수로 req() 를 호출해도 `${apiBaseV1}*` 같은 깨진 URL 생성 차단.
  if (base === '*') {
    return blockedJson(
      `Tool '${toolName}' is a built-in tool (no backend request). It must be handled by its own tool handler, not routed through req().`
    );
  }
  const path = pathSuffix ? `${base}${pathSuffix}` : base;
  const stepUpSid = config.verifiedStepup?.sid;
  const raw = await request(config, {
    ...input,
    path,
    ...(stepUpSid ? { stepUpSid } : {}),
  });

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      const p = parsed as Record<string, unknown>;
      const data = p.data;
      if (
        p.status === 403 &&
        data !== null &&
        typeof data === 'object' &&
        !Array.isArray(data)
      ) {
        const errorCode = (data as Record<string, unknown>).errorCode;
        if (
          typeof errorCode === 'string' &&
          PLAN_LIMIT_ERROR_CODES.has(errorCode)
        ) {
          return JSON.stringify({ ...p, upgradeHint: UPGRADE_HINT }, null, 2);
        }
      }
    }
  } catch {
    // Returns the raw response if JSON parsing fails.
  }

  return raw;
}

/**
 * Fetches the project's domain_url and appends ?tc_mode=console.
 * Returns null if the request fails or domain_url is missing.
 */
export async function getConsoleUrl(
  config: ProxyConfig,
  projectId: string
): Promise<string | null> {
  try {
    const raw = await req(
      config,
      { method: 'GET' },
      'get_project',
      `/${projectId}`
    );
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      const data = (parsed as Record<string, unknown>).data;
      if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
        const payload = (data as Record<string, unknown>).payload;
        if (Array.isArray(payload) && payload.length > 0) {
          const project = payload[0] as Record<string, unknown>;
          const domainUrl = project.domain_url;
          if (typeof domainUrl === 'string' && domainUrl.trim()) {
            return `${domainUrl.replace(/\/$/, '')}?tc_mode=console`;
          }
        }
      }
    }
  } catch {
    // Returns null on request or parse failure.
  }
  return null;
}

/** Returns a blocked response string that includes the console_url when available. */
export function blockedWithConsole(url: string | null): string {
  const message =
    'This action must be performed by the user on your site. ' +
    'Visit the console URL below, log in, and manage your authentication credentials from there.';
  return JSON.stringify(
    url
      ? { ok: false, blocked: true, message, console_url: url }
      : { ok: false, blocked: true, message },
    null,
    2
  );
}

/**
 * Browser-only tools (passkeys, authenticators, totp, etc.): resolve `domain_url` via get_project,
 * then return a blockedWithConsole response with `?tc_mode=console` (get_project → domain_url?tc_mode=console).
 */
export async function blockedWithConsoleFromProject(
  config: ProxyConfig,
  projectId: string
): Promise<string> {
  const url = await getConsoleUrl(config, projectId);
  return blockedWithConsole(url);
}

