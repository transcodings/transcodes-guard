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
import { request, type RequestInput } from "../stepup/client.js";
import type { StepupConfig } from "../stepup/config.js";

/** Tool name → API path under `/v1`. Scoped to this plugin's ported toolset. */
const ENDPOINT_MAP: Readonly<Record<string, string>> = {
  // Members
  get_member: "/auth/member",
  list_members_paginated: "/auth/members/list",
  list_member_devices: "/auth/members/devices",
  get_member_suspension: "/auth/member/revocation",
  retire_member: "/auth/member",
  suspend_member: "/auth/member/revocation",
  unsuspend_member: "/auth/member/revocation",

  // RBAC — roles
  get_roles: "/auth/roles",
  check_rbac_permission: "/auth/role/check-permission",
  retire_role: "/auth/role",
  set_role_permissions: "/auth/role",
  update_member_role: "/auth/member/role",

  // RBAC — resources
  get_resources: "/auth/resources",
  retire_resource: "/auth/resources",

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

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Arg-parse helpers — kept thin since zod already validates each schema. */
export const parse = {
  record(v: unknown): Record<string, unknown> {
    return isPlainRecord(v) ? v : {};
  },
};
