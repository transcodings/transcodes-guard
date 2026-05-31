/**
 * Tool-name → backend path map + thin request wrapper for the ported
 * step-up-protected toolset.
 *
 * Adapted from transcodes-mcp-server/src/constants.ts (endpoint map) and
 * src/tools/tool-utils.ts (`req` helper). Step-up enforcement is NOT here
 * — the PreToolUse hook gates protected calls via `hooks/tool-rules.json`
 * before this layer runs, and tool handlers thread the verified sid
 * through `withStepupVerifiedSid` so `request()` can attach the
 * `X-Step-Up-Session-Id` header.
 */
import {
  request,
  type HttpRequestInput as RequestInput,
  type StepupConfig,
} from "@transcodes-guard/stepup-core";

/** Tool name → API path under `/v1`. Scoped to this plugin's ported toolset. */
const ENDPOINT_MAP: Readonly<Record<string, string>> = {
  // Project
  get_project: "/project",

  // Audit
  get_security_logs: "/audit/logs",

  // Members
  get_member: "/auth/member",
  list_members_paginated: "/auth/members/list",
  list_member_devices: "/auth/members/devices",
  create_member: "/auth/member",
  update_member: "/auth/member",
  get_member_suspension: "/auth/member/revocation",
  retire_member: "/auth/member",
  suspend_member: "/auth/member/revocation",
  unsuspend_member: "/auth/member/revocation",

  // Auth devices — authenticators
  list_authenticators: "/auth/authenticators",

  // Auth devices — passkeys
  list_passkeys: "/auth/passkeys",

  // Auth devices — TOTP
  list_totps: "/auth/totps",

  // RBAC — roles
  get_roles: "/auth/roles",
  create_role: "/auth/role",
  update_role: "/auth/role",
  check_rbac_permission: "/auth/role/check-permission",
  retire_role: "/auth/role",
  set_role_permissions: "/auth/role",
  update_member_role: "/auth/member/role",

  // RBAC — resources
  get_resources: "/auth/resources",
  create_resource: "/auth/resources",
  update_resource: "/auth/resources",
  retire_resource: "/auth/resources",

  // Membership / billing
  membership_plans: "/membership/plans",
  membership_plans_limits: "/membership/plans/limits",
  membership_customer_status_by_project: "/membership/customer/status/project",
  membership_customer_status_by_organization:
    "/membership/customer/status/organization",
  membership_create_checkout_session: "/membership/mcp/session",

  // Passcode
  passcode_create: "/auth/passcode/create",
};

export type ReqInput = Omit<RequestInput, "path">;

/**
 * Resolve the tool's base path from ENDPOINT_MAP + optional `pathSuffix`
 * and call the backend. Returns a JSON-stringified envelope so the model
 * sees a stable shape regardless of HTTP outcome (success, 4xx, network
 * error). Mirrors transcodes-mcp-server's `req()` output contract.
 */
export async function req(
  config: StepupConfig,
  input: ReqInput,
  toolName: string,
  pathSuffix?: string,
): Promise<string> {
  const base = ENDPOINT_MAP[toolName];
  if (!base) {
    return JSON.stringify(
      {
        ok: false,
        blocked: true,
        message: `Tool '${toolName}' is not in this plugin's endpoint map.`,
      },
      null,
      2,
    );
  }
  const path = pathSuffix ? `${base}${pathSuffix}` : base;
  const envelope = await request(config, { ...input, path });
  return JSON.stringify(envelope, null, 2);
}

/**
 * Result for console-only tools that intentionally do NOT call the backend.
 * They exist purely for discoverability + routing: the agent learns the
 * capability exists and that it must be performed in the Transcodes console.
 * Ported from transcodes-mcp-server/src/tools/tool-utils.ts `blocked`.
 */
export function blockedResult(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ok: false, blocked: true, message }, null, 2),
      },
    ],
  };
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Arg-parse helpers — kept thin since zod already validates each schema. */
export const parse = {
  record(v: unknown): Record<string, unknown> {
    return isPlainRecord(v) ? v : {};
  },
};
