#!/usr/bin/env node
import {
  PatternValidationError,
  ToolRuleValidationError,
  addUserPattern,
  addUserToolRule,
  clearPending,
  consumeVerified,
  createStepupSession,
  findFirstMatch,
  findFirstToolRule,
  getUserPatternsPath,
  getUserToolRulesPath,
  inspectStepupState,
  isTrackerEnabled,
  loadMergedPatterns,
  loadMergedToolRules,
  loadStepupConfig,
  markVerified,
  parseMemberAccessToken,
  pollStepupSession,
  pollStepupSessionWait,
  readVerified,
  removeUserPattern,
  removeUserToolRule,
  request,
  resolveToken,
  setTrackerEnabled,
  transcodesConfigFile,
  updateUserPattern,
  updateUserToolRule,
  writeVerified
} from "../chunk-Z7RXJPDK.js";

// src/stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ../../packages/mcp-server-core/dist/server.js
import { spawn as childSpawn } from "child_process";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z9 } from "zod";

// ../../packages/mcp-server-core/dist/tools/audit.js
import { z } from "zod";

// ../../packages/mcp-server-core/dist/tools/transcodes-client.js
var ENDPOINT_MAP = {
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
  membership_customer_status_by_organization: "/membership/customer/status/organization",
  membership_create_checkout_session: "/membership/mcp/session",
  // Passcode
  passcode_create: "/auth/passcode/create"
};
async function req(config, input, toolName, pathSuffix) {
  const base = ENDPOINT_MAP[toolName];
  if (!base) {
    return JSON.stringify({
      ok: false,
      blocked: true,
      message: `Tool '${toolName}' is not in this plugin's endpoint map.`
    }, null, 2);
  }
  const path2 = pathSuffix ? `${base}${pathSuffix}` : base;
  const envelope = await request(config, { ...input, path: path2 });
  return JSON.stringify(envelope, null, 2);
}
function blockedResult(message) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, blocked: true, message }, null, 2)
      }
    ]
  };
}

// ../../packages/mcp-server-core/dist/tools/audit.js
var textResult = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
function registerAuditTools(server) {
  server.registerTool("get_security_logs", {
    title: "Get security logs",
    description: "List project audit logs with pagination and filters. Use for security investigations, login/admin activity review, compliance. Returns tag, severity, IP, user_agent, member_id, metadata. Filter by `tag`; `start_date`/`end_date` are ISO 8601 range filters.",
    inputSchema: {
      page: z.number().optional(),
      limit: z.number().optional(),
      tag: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional()
    }
  }, async ({ page, limit, tag, start_date, end_date }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: {
        project_id: config.projectId,
        page,
        limit,
        tag,
        start_date,
        end_date
      }
    }, "get_security_logs");
    return textResult(text);
  });
}

// ../../packages/mcp-server-core/dist/tools/auth-devices.js
import { z as z2 } from "zod";
var textResult2 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
function registerAuthDeviceTools(server) {
  server.registerTool("list_authenticators", {
    title: "List authenticators",
    description: "List all WebAuthn authenticators for a member. Separate from the passkey service. Requires member_id.",
    inputSchema: {
      member_id: z2.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "list_authenticators");
    return textResult2(text);
  });
  server.registerTool("list_passkeys", {
    title: "List passkeys",
    description: "List passkeys for a member. Server typically filters by project rp_id. Requires member_id.",
    inputSchema: {
      member_id: z2.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "list_passkeys");
    return textResult2(text);
  });
  server.registerTool("list_totps", {
    title: "List TOTP devices",
    description: "List TOTP devices for a member. Use to audit MFA enrollment. Requires member_id.",
    inputSchema: {
      member_id: z2.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "list_totps");
    return textResult2(text);
  });
}

// ../../packages/mcp-server-core/dist/tools/jwk.js
var MSG_JWK_BACKUP_CONSOLE = "JWK backup (encrypted download of member metadata, registered authentication methods, and audit logs) must be done in the Transcodes console. This MCP tool does not call the API.";
function registerJwkTools(server) {
  server.registerTool("jwk_backup", {
    title: "JWK backup (console-only)",
    description: "Blocked: JWK backup must be performed in the Transcodes console only. That flow yields an encrypted backup bundle that can include member metadata, authentication methods, and audit logs \u2014 not exposed through MCP.",
    inputSchema: {}
  }, async () => blockedResult(MSG_JWK_BACKUP_CONSOLE));
}

// ../../packages/mcp-server-core/dist/tools/members.js
import { z as z3 } from "zod";

// ../../packages/mcp-server-core/dist/tools/stepup-helper.js
async function withStepupVerifiedSid(toolName, fn) {
  const verified = readVerified();
  if (!verified) {
    throw new Error(`step-up verified record missing for ${toolName} \u2014 the PreToolUse hook should have populated it before this handler was invoked`);
  }
  try {
    return await fn(verified.sid);
  } finally {
    consumeVerified();
    clearPending();
  }
}

// ../../packages/mcp-server-core/dist/tools/members.js
var textResult3 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
var MEMBER_SUSPENSION_API_NOTE = "Exact path after /v1: /auth/member/revocation (singular member, NOT members). GET=query only; POST=suspend body; DELETE=unsuspend body. No PUT, PATCH, or /member/suspend.";
function registerMemberTools(server) {
  server.registerTool("get_member", {
    title: "Get member",
    description: "Get one member profile. Pass `member_id` OR `email` \u2014 at least one is required (never omit both). Use for support lookups and auth debugging.",
    inputSchema: {
      member_id: z3.string().optional(),
      email: z3.string().optional()
    }
  }, async ({ member_id, email }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: {
        project_id: config.projectId,
        member_id,
        email
      }
    }, "get_member");
    return textResult3(text);
  });
  server.registerTool("list_members_paginated", {
    title: "List members (paginated)",
    description: "Paginated member list without search. Fast for large directories; use sort_by/order.",
    inputSchema: {
      page: z3.number().optional(),
      limit: z3.number().optional(),
      sort_by: z3.enum(["created_at", "updated_at"]).optional(),
      order: z3.enum(["asc", "desc"]).optional()
    }
  }, async ({ page, limit, sort_by, order }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: {
        project_id: config.projectId,
        page,
        limit,
        sort_by,
        order
      }
    }, "list_members_paginated");
    return textResult3(text);
  });
  server.registerTool("list_member_devices", {
    title: "List member devices",
    description: "Summary of passkeys, authenticators, and TOTP devices for a member. Labels and last-used timestamps. Use to audit MFA surface.",
    inputSchema: {
      member_id: z3.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "list_member_devices");
    return textResult3(text);
  });
  server.registerTool("get_member_suspension", {
    title: "Get member suspension status",
    description: "Check whether a member is currently suspended and when it was applied. Returns { revoked_at: ISO date string } if suspended, or { revoked_at: null } if active. Read-only. " + MEMBER_SUSPENSION_API_NOTE,
    inputSchema: {
      member_id: z3.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "get_member_suspension");
    return textResult3(text);
  });
  server.registerTool("retire_member", {
    title: "Retire member (permanent)",
    description: "PERMANENTLY delete a member from the project (kill switch \u2014 irreversible). Use only when the user wants to fully delete / remove a member; for a temporary block use suspend_member. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-retire-member`). Body: { member_id } \u2014 project_id comes from TRANSCODES_TOKEN.",
    inputSchema: {
      body: z3.object({ member_id: z3.string() })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await withStepupVerifiedSid("retire_member", (sid) => req(config, {
      method: "DELETE",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "retire_member"));
    return textResult3(text);
  });
  server.registerTool("suspend_member", {
    title: "Suspend member (reversible)",
    description: "Temporarily SUSPEND a member: blocks login and invalidates active sessions. Reversible via unsuspend_member. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-suspend-member`). " + MEMBER_SUSPENSION_API_NOTE,
    inputSchema: {
      body: z3.object({ member_id: z3.string() })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await withStepupVerifiedSid("suspend_member", (sid) => req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "suspend_member"));
    return textResult3(text);
  });
  server.registerTool("unsuspend_member", {
    title: "Unsuspend member",
    description: "Lift a member's suspension and restore their ability to log in and create sessions. Use only on members previously suspended. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-unsuspend-member`). " + MEMBER_SUSPENSION_API_NOTE,
    inputSchema: {
      body: z3.object({ member_id: z3.string() })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await withStepupVerifiedSid("unsuspend_member", (sid) => req(config, {
      method: "DELETE",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "unsuspend_member"));
    return textResult3(text);
  });
  server.registerTool("create_member", {
    title: "Create member",
    description: "Create a member (CreateMemberDto). member_id/name may be auto-generated. Use for onboarding or manual provisioning. Auth: TRANSCODES_TOKEN sent as x-transcodes-token (not in body).",
    inputSchema: {
      body: z3.object({
        email: z3.string(),
        name: z3.string().optional(),
        role: z3.string().optional(),
        metadata: z3.record(z3.string(), z3.unknown()).optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId }
    }, "create_member");
    return textResult3(text);
  });
  server.registerTool("update_member", {
    title: "Update member",
    description: "Update member fields (UpdateMemberDto, flat shape). Auth: TRANSCODES_TOKEN sent as x-transcodes-token (not in body). member_id is required \u2014 supply the target member explicitly (it may differ from the caller).",
    inputSchema: {
      body: z3.object({
        member_id: z3.string(),
        name: z3.string().optional(),
        email: z3.string().optional(),
        role: z3.string().optional(),
        metadata: z3.record(z3.string(), z3.unknown()).optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "PUT",
      body: { ...body, project_id: config.projectId }
    }, "update_member");
    return textResult3(text);
  });
}

// ../../packages/mcp-server-core/dist/tools/membership.js
import { z as z4 } from "zod";
var textResult4 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
function registerMembershipTools(server) {
  server.registerTool("membership_plans", {
    title: "Membership plans",
    description: "Returns the full list of available Transcodes membership plans (free, standard, business, enterprise) including price, currency, billing interval, and Stripe product metadata. This is a public endpoint \u2014 no authentication required. Use this tool to display plan options to users or to look up the price_id needed for membership_create_checkout_session.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET" }, "membership_plans");
    return textResult4(text);
  });
  server.registerTool("membership_plans_limits", {
    title: "Membership plan limits",
    description: "Returns the resource limits enforced per plan tier. Each plan entry includes: projects (max projects allowed), roles, resources, members (max members per project), and price (monthly USD, null = contact for pricing). Free tier: 1 project / 2 roles / 2 resources / 2 members. Standard: 5 projects / unlimited roles & resources / 10 members. Business & Enterprise: unlimited everything. Use this to build pricing comparison UI or to warn users when they are approaching a limit.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET" }, "membership_plans_limits");
    return textResult4(text);
  });
  server.registerTool("membership_customer_status_by_project", {
    title: "Customer status by project",
    description: "Returns the active subscription status of the organization that owns the project in TRANSCODES_TOKEN (pid claim). SkipAuth \u2014 GET /v1/membership/customer/status/project?project_id=... Useful when the SDK Toolkit only carries a project context.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET", query: { project_id: config.projectId } }, "membership_customer_status_by_project");
    return textResult4(text);
  });
  server.registerTool("membership_customer_status_by_organization", {
    title: "Customer status by organization",
    description: "Returns the active subscription status for the organization in TRANSCODES_TOKEN (oid claim). SkipAuth \u2014 GET /v1/membership/customer/status/organization?organization_id=... Preferred when the caller already knows the organization (avoids the project \u2192 organization lookup).",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET", query: { organization_id: config.organizationId } }, "membership_customer_status_by_organization");
    return textResult4(text);
  });
  server.registerTool("membership_create_checkout_session", {
    title: "Create checkout session",
    description: 'MCP checkout: POST /v1/membership/mcp/session \u2014 creates a Stripe Checkout session for the organization bound to the MAT (x-transcodes-token) and returns a one-time redirect URL. Use for plan upgrade or first purchase (e.g. free \u2192 standard). Body: price_id from membership_plans; optional mode: "subscription" (default) | "payment" | "setup". Organization is resolved server-side from the authenticated principal \u2014 do not pass organization_id in the body. The returned URL expires after a short window \u2014 redirect the user immediately after receiving it.',
    inputSchema: {
      body: z4.object({
        price_id: z4.string(),
        mode: z4.enum(["subscription", "payment", "setup"]).optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "POST", body }, "membership_create_checkout_session");
    return textResult4(text);
  });
}

// ../../packages/mcp-server-core/dist/tools/meta.js
import { z as z5 } from "zod";
var INSTRUCTIONS_URL = "https://transcodes.io/instructions";
var textResult5 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
function registerMetaTools(server) {
  server.registerTool("get_current_project_id", {
    title: "Get current project id",
    description: "Returns the active project ID parsed from TRANSCODES_TOKEN. Call this tool first when you need the project ID instead of asking the user.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    return textResult5(JSON.stringify({ ok: true, project_id: config.projectId }, null, 2));
  });
  server.registerTool("get_current_organization_id", {
    title: "Get current organization id",
    description: "Returns organizationId from TRANSCODES_TOKEN JWT.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    return textResult5(JSON.stringify({ ok: true, organization_id: config.organizationId }, null, 2));
  });
  server.registerTool("get_current_member_id", {
    title: "Get current member id",
    description: "Returns memberId from TRANSCODES_TOKEN JWT.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    return textResult5(JSON.stringify({ ok: true, member_id: config.memberId }, null, 2));
  });
  server.registerTool("get_my_profile", {
    title: "Get my profile",
    description: 'Returns the profile of the member identified by TRANSCODES_TOKEN (organizationId, projectId, memberId in config). Use when the user asks "who am I", "show my profile", or "show my member info". No arguments needed.',
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id: config.memberId }
    }, "get_member");
    return textResult5(text);
  });
  server.registerTool("get_console_url", {
    title: "Get console URL",
    description: "Mint a step-up-protected console URL. Console access is gated behind step-up MFA (mode=console) so this tool creates a step-up session and returns the browser URL the user must visit to authenticate (WebAuthn) before reaching the console. Use when the user needs to perform browser-only actions: passkey register/update/revoke, authenticator register/update/revoke, TOTP enroll/update/revoke, OTP flows, JWK backup, or subscription portal (cancel, payment method, invoices). Direct the user to visit the returned browser_url and complete the action there.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const result = await createStepupSession(config, {
      comment: "Open the Transcodes console (browser-only action)",
      action: "verify",
      resource: "transcodes:console",
      mode: "console"
    });
    return textResult5(JSON.stringify({
      ok: result.envelope.ok,
      status: result.envelope.status,
      sid: result.sid,
      browser_url: result.browserUrl,
      expires_at: result.expiresAt,
      message: result.browserUrl ? "Console access is protected by step-up MFA. Direct the user to browser_url to authenticate, then complete the browser-only action." : "Could not mint a console step-up session. Check the token and backend connectivity.",
      raw: result.envelope.data
    }, null, 2));
  });
  server.registerTool("get_integration_guide", {
    title: "Get integration guide",
    description: "IMPORTANT: You MUST call this tool BEFORE writing ANY Transcodes-related code. Fetches the official Transcodes integration guide (llms.txt) \u2014 the single source of truth for all implementation details. Trigger keywords: install, setup, integrate, SDK, PWA, passkey, auth, login, signup, modal, step-up, MFA, JWT, token, audit, webhook, RBAC, role, service worker, manifest, CDN, webworker, sign-in, sign-out, session, member, console, admin, IDP, OTP, TOTP, biometric, WebAuthn. The returned guide contains exact API signatures, code examples, framework setup (React, Next.js, Vue, Vite), CSP rules, JWT verification, and common mistakes. You MUST follow it instead of guessing. Call once per conversation \u2014 the result stays in context for follow-up requests.",
    inputSchema: {
      topic: z5.string().optional()
    }
  }, async ({ topic }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15e3);
    try {
      const response = await fetch(INSTRUCTIONS_URL, {
        headers: { Accept: "text/plain" },
        signal: controller.signal
      });
      const content = await response.text();
      const trimmed = topic?.trim();
      if (trimmed) {
        return textResult5(JSON.stringify({ topic: trimmed, instructions: content }, null, 2));
      }
      return textResult5(content);
    } catch (err) {
      return textResult5(`Could not fetch the integration guide: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      clearTimeout(timer);
    }
  });
}

// ../../packages/mcp-server-core/dist/tools/organization.js
import { z as z6 } from "zod";
var MSG_PLATFORM_CONSOLE = "User and organization management must be done in the Transcodes console. This MCP tool does not call the API.";
var MSG_ORG_CONSOLE = "Organization settings, user invitations, and invitation management (send, update, cancel, accept, decline) must be done directly in the Transcodes console at https://transcodes.io. This MCP tool does not call the API.";
var MSG_MEMBER_TOKEN_CONSOLE = "Per-member MCP tokens (TRANSCODES_TOKEN \u2014 the JWT sent as the x-transcodes-token header) can only be issued from the Transcodes console at https://app.transcodes.io. This MCP tool does not call the API \u2014 open the console, sign in, and create or rotate the token from the member detail page; then store it in your MCP client config.";
function registerOrganizationTools(server) {
  server.registerTool("user_get_current", {
    title: "Get current user (console-only)",
    description: "Blocked: current user profile must be managed in the Transcodes console / host app (Firebase Bearer).",
    inputSchema: {}
  }, async () => blockedResult(MSG_PLATFORM_CONSOLE));
  server.registerTool("user_find", {
    title: "Find user (console-only)",
    description: "Blocked: user lookup must be done in the Transcodes console.",
    inputSchema: {
      ids: z6.string().optional().describe("comma-separated"),
      emails: z6.string().optional().describe("comma-separated")
    }
  }, async () => blockedResult(MSG_PLATFORM_CONSOLE));
  server.registerTool("user_create", {
    title: "Create user (console-only)",
    description: "Blocked: user creation must be done in the Transcodes console.",
    inputSchema: {}
  }, async () => blockedResult(MSG_PLATFORM_CONSOLE));
  server.registerTool("user_patch", {
    title: "Update user (console-only)",
    description: "Blocked: user updates must be done in the Transcodes console.",
    inputSchema: {}
  }, async () => blockedResult(MSG_PLATFORM_CONSOLE));
  server.registerTool("user_delete", {
    title: "Delete user (console-only)",
    description: "Blocked: user deletion must be done in the Transcodes console.",
    inputSchema: {}
  }, async () => blockedResult(MSG_PLATFORM_CONSOLE));
  server.registerTool("organization_get", {
    title: "Get organization (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {}
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_overview", {
    title: "Organization overview (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {}
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_create", {
    title: "Create organization (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {}
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_patch", {
    title: "Update organization (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {
      organization_id: z6.string(),
      body: z6.record(z6.string(), z6.unknown())
    }
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_delete", {
    title: "Delete organization (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {
      organization_id: z6.string()
    }
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_invitation_accept", {
    title: "Accept invitation (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {}
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_invitation_decline", {
    title: "Decline invitation (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {}
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_get_collaborators", {
    title: "Get collaborators (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {
      organization_id: z6.string()
    }
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_invite_collaborator", {
    title: "Invite collaborator (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {
      organization_id: z6.string(),
      body: z6.record(z6.string(), z6.unknown())
    }
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_resend_invitation", {
    title: "Resend invitation (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {
      organization_id: z6.string(),
      body: z6.record(z6.string(), z6.unknown())
    }
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("organization_leave_collaborator", {
    title: "Leave organization (console-only)",
    description: "Blocked: organization settings, user invitations, and invitation management must be done in the Transcodes console at https://transcodes.io.",
    inputSchema: {
      organization_id: z6.string(),
      body: z6.record(z6.string(), z6.unknown())
    }
  }, async () => blockedResult(MSG_ORG_CONSOLE));
  server.registerTool("member_token_create", {
    title: "Create member token (console-only)",
    description: 'Blocked: issuing a per-member MCP token (TRANSCODES_TOKEN \u2014 the JWT used as x-transcodes-token) must be done in the Transcodes console only. Use this when the user asks to "create / issue / rotate / regenerate / get a new" member token, MCP token, x-transcodes-token, or member JWT. This MCP tool does not call the API \u2014 direct the user to the Transcodes console (https://transcodes.io) member detail page to mint the token, then have them paste it into their MCP client config.',
    inputSchema: {}
  }, async () => blockedResult(MSG_MEMBER_TOKEN_CONSOLE));
}

// ../../packages/mcp-server-core/dist/tools/passcode.js
import { z as z7 } from "zod";
var textResult6 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
function registerPasscodeTools(server) {
  server.registerTool("passcode_create", {
    title: "Create recovery passcode",
    description: "Create a recovery passcode (CreatePasscodeDto in body). Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-passcode-create`). Use for onboarding, support, or admin provisioning.",
    inputSchema: {
      body: z7.object({ member_id: z7.string() })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await withStepupVerifiedSid("passcode_create", (sid) => req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "passcode_create"));
    return textResult6(text);
  });
}

// ../../packages/mcp-server-core/dist/tools/project.js
var textResult7 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
var MSG_PROJECT_PWA_AUTH_CONSOLE = "PWA and authentication configuration (manifest, service worker, widget, branding, WebAuthn, related origins, token expiry, etc.) must be performed in the Transcodes console. Changes to these settings require the project SDK to be rebuilt and redeployed \u2014 a process that the console handles automatically. Modifying them directly via API without going through the console build pipeline will leave the deployed SDK out of sync with your configuration. This MCP tool does not call the API.";
function registerProjectTools(server) {
  server.registerTool("get_project", {
    title: "Get project",
    description: "Fetch the active project (fixed by TRANSCODES_TOKEN pid claim). Returns all information about the project \u2014 including toolkit, pwa, domain_url, title, description, and created/updated timestamps. No arguments \u2014 project is determined by the token.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET" }, "get_project", `/${config.projectId}`);
    return textResult7(text);
  });
  server.registerTool("project_pwa_auth_console", {
    title: "PWA / auth config (console-only)",
    description: "Blocked: PWA and authentication configuration (manifest, service worker, branding, WebAuthn, related origins, token expiry, etc.) must be done in the Transcodes console. These settings trigger an SDK rebuild and redeployment \u2014 a pipeline the console manages automatically. Applying changes directly via API skips that pipeline and leaves the live SDK out of sync with the new configuration.",
    inputSchema: {}
  }, async () => blockedResult(MSG_PROJECT_PWA_AUTH_CONSOLE));
}

// ../../packages/mcp-server-core/dist/tools/rbac.js
import { z as z8 } from "zod";
var textResult8 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
var PROJECT_ID_GUIDANCE = "project_id in the body must be the TRANSCODES_TOKEN project id (pid claim); it is not configurable per tool call.";
var PermissionLevel = z8.union([z8.literal(0), z8.literal(1), z8.literal(2)]);
var ResourcePermissions = z8.object({
  create: PermissionLevel.optional(),
  read: PermissionLevel.optional(),
  update: PermissionLevel.optional(),
  delete: PermissionLevel.optional()
});
function registerRbacTools(server) {
  server.registerTool("get_roles", {
    title: "Get roles",
    description: "List all roles and permission matrix for a project. Use when you need RBAC data for console parity or to know which roles can be assigned.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET", query: { project_id: config.projectId } }, "get_roles");
    return textResult8(text);
  });
  server.registerTool("get_resources", {
    title: "Get resources",
    description: "List RBAC resource keys for a project. Use before editing roles or building permission UI.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET", query: { project_id: config.projectId } }, "get_resources");
    return textResult8(text);
  });
  server.registerTool("check_rbac_permission", {
    title: "Check RBAC permission",
    description: "Simulate whether a member may access a resource+action (SkipAuth). Returns denied/allowed; if allowed, may include stepUpRequired. Use for guard/debugging before routing.",
    inputSchema: {
      body: z8.object({
        member_id: z8.string(),
        resource: z8.string(),
        action: z8.enum(["create", "read", "update", "delete"])
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId }
    }, "check_rbac_permission");
    return textResult8(text);
  });
  server.registerTool("retire_role", {
    title: "Retire role",
    description: "Retire a role from the project. Use when the user wants to remove, drop, or discard a role. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-retire-role`). Body { project_id } is injected from TRANSCODES_TOKEN by the server.",
    inputSchema: {
      role_id: z8.string()
    }
  }, async ({ role_id }) => {
    const config = loadStepupConfig();
    const text = await withStepupVerifiedSid("retire_role", (sid) => req(config, {
      method: "DELETE",
      body: { project_id: config.projectId },
      stepUpSid: sid
    }, "retire_role", `/${encodeURIComponent(role_id)}`));
    return textResult8(text);
  });
  server.registerTool("set_role_permissions", {
    title: "Set role permissions",
    description: "Set per-resource permission matrix for a role. 0=deny, 1=allow, 2=allow+step-up. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-set-role-permissions`).",
    inputSchema: {
      role_id: z8.string(),
      body: z8.object({
        permissions: z8.record(z8.string(), ResourcePermissions)
      })
    }
  }, async ({ role_id, body }) => {
    const config = loadStepupConfig();
    const text = await withStepupVerifiedSid("set_role_permissions", (sid) => req(config, {
      method: "PUT",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "set_role_permissions", `/${encodeURIComponent(role_id)}/permissions`));
    return textResult8(text);
  });
  server.registerTool("update_member_role", {
    title: "Update member role",
    description: "Change a member's assigned role (UpdateMemberRoleDto). Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-update-member-role`).",
    inputSchema: {
      body: z8.object({
        member_id: z8.string(),
        role: z8.string()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await withStepupVerifiedSid("update_member_role", (sid) => req(config, {
      method: "PUT",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "update_member_role"));
    return textResult8(text);
  });
  server.registerTool("retire_resource", {
    title: "Retire resource",
    description: "Retire a resource key from the project. Use when the user wants to remove, drop, or discard a resource. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-retire-resource`). Path: resource_key. Query: project_id. No JSON body.",
    inputSchema: {
      resource_key: z8.string()
    }
  }, async ({ resource_key }) => {
    const config = loadStepupConfig();
    const text = await withStepupVerifiedSid("retire_resource", (sid) => req(config, {
      method: "DELETE",
      query: { project_id: config.projectId },
      omitBody: true,
      stepUpSid: sid
    }, "retire_resource", `/${encodeURIComponent(resource_key)}`));
    return textResult8(text);
  });
  server.registerTool("create_role", {
    title: "Create role",
    description: "Create a new role (CreateRoleDto). Use before set_role_permissions to fill per-resource access. " + PROJECT_ID_GUIDANCE,
    inputSchema: {
      body: z8.object({
        name: z8.string(),
        description: z8.string().optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId }
    }, "create_role");
    return textResult8(text);
  });
  server.registerTool("update_role", {
    title: "Update role",
    description: "Update role metadata (UpdateRoleDto). " + PROJECT_ID_GUIDANCE,
    inputSchema: {
      role_id: z8.string(),
      body: z8.object({
        description: z8.string().optional()
      })
    }
  }, async ({ role_id, body }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "PUT",
      body: { ...body, project_id: config.projectId }
    }, "update_role", `/${encodeURIComponent(role_id)}`);
    return textResult8(text);
  });
  server.registerTool("create_resource", {
    title: "Create resource",
    description: "Add a new resource key (CreateResourceDto). New resources default to deny (0) for all roles. " + PROJECT_ID_GUIDANCE,
    inputSchema: {
      body: z8.object({
        key: z8.string(),
        name: z8.string(),
        description: z8.string().optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId }
    }, "create_resource");
    return textResult8(text);
  });
  server.registerTool("update_resource", {
    title: "Update resource",
    description: "Update resource label/description (UpdateResourceDto). Key stays the same. " + PROJECT_ID_GUIDANCE,
    inputSchema: {
      resource_key: z8.string(),
      body: z8.object({
        description: z8.string().optional()
      })
    }
  }, async ({ resource_key, body }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "PATCH",
      body: { ...body, project_id: config.projectId }
    }, "update_resource", `/${encodeURIComponent(resource_key)}`);
    return textResult8(text);
  });
}

// ../../packages/mcp-server-core/dist/server.js
function formatPatternsMarkdown(patterns) {
  const lines = [
    "# Blocked Bash command patterns",
    "",
    `${patterns.length} pattern(s) intercept Bash invocations before execution.`,
    `User patterns live at \`${getUserPatternsPath()}\` and are editable through the \`add_user_pattern\`/\`update_user_pattern\`/\`remove_user_pattern\` tools. System patterns are immutable.`,
    "",
    "| source | id | reason | regex |",
    "| ------ | -- | ------ | ----- |"
  ];
  for (const { source, id, reason, regex } of patterns) {
    lines.push(`| ${source} | \`${id}\` | ${reason} | \`${regex}\` |`);
  }
  return lines.join("\n");
}
function formatToolRulesMarkdown(rules) {
  const lines = [
    "# Step-up-protected MCP tool rules",
    "",
    `${rules.length} rule(s) gate MCP tool invocations via the PreToolUse hook.`,
    `User rules live at \`${getUserToolRulesPath()}\` and are editable through the \`add_tool_rule\`/\`update_tool_rule\`/\`remove_tool_rule\` tools. System rules are immutable.`,
    "",
    "| source | id | toolName | reason | action | resource | consume_in_hook |",
    "| ------ | -- | -------- | ------ | ------ | -------- | --------------- |"
  ];
  for (const r of rules) {
    lines.push(`| ${r.source} | \`${r.id}\` | \`${r.toolName}\` | ${r.reason} | ${r.stepupAction} | ${r.stepupResource} | ${r.consume_in_hook ?? false} |`);
  }
  return lines.join("\n");
}
function textResult9(text, isError = false) {
  return {
    isError,
    content: [{ type: "text", text }]
  };
}
function createServer() {
  const server = new McpServer({
    name: "ai-action-tracker-mcp",
    version: "0.1.0"
  });
  server.registerResource("danger-patterns", "danger-patterns://list", {
    title: "Blocked Bash patterns",
    description: `Regex patterns the PreToolUse hook uses to block dangerous Bash commands. Merges immutable system patterns (hooks/danger-patterns.json) with user patterns (${getUserPatternsPath()}, JSONC \u2014 comments allowed for hand-edits), read fresh at every request.`,
    mimeType: "text/markdown"
  }, async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: formatPatternsMarkdown(loadMergedPatterns())
      }
    ]
  }));
  server.registerTool("simulate_command", {
    title: "Simulate command against block patterns",
    description: "Check whether a specific Bash command would be blocked by the PreToolUse hook's regex layer. Call this whenever the user mentions a concrete command and asks if it is dangerous, safe, blocked, intercepted, allowed, or whether the hook/danger-patterns would catch it \u2014 including Korean phrasings like '\uC774 \uBA85\uB839 \uCC28\uB2E8\uB420\uAE4C', '\uC774\uAC70 hook\uC5D0 \uAC78\uB824?', 'rm -rf src \uC2E4\uD589\uD574\uB3C4 \uB3FC?', '\uBBF8\uB9AC \uAC80\uC0AC\uD574\uC918'. Runs against the union of system and user patterns. Does NOT simulate the second-layer `rm -rf` git-tracked check (cwd-dependent), so the hook may still block commands this tool reports as allowed.",
    inputSchema: { command: z9.string().min(1) }
  }, async ({ command }) => {
    const patterns = loadMergedPatterns();
    const hit = findFirstMatch(command, patterns);
    if (!hit) {
      return textResult9(JSON.stringify({
        matched: false,
        will_trigger_hook: false,
        patterns_checked: patterns.length,
        note: "Hook may still block via the rm -rf git-tracked semantic check; simulator does not cover that layer."
      }, null, 2));
    }
    const m = hit.matched;
    return textResult9(JSON.stringify({
      matched: true,
      matched_by: m.source,
      pattern_id: m.id,
      reason: m.reason,
      regex: m.regex,
      will_trigger_hook: m.source === "system",
      note: m.source === "user" ? "User patterns are matched by the simulator but do NOT reliably trigger Claude Code's actual PreToolUse hook. Use only system patterns for live verification." : "System pattern: Claude Code will route a matching Bash command through the PreToolUse hook."
    }, null, 2));
  });
  server.registerTool("add_user_pattern", {
    title: "Add user danger pattern",
    description: `Register a new user-owned block pattern that the PreToolUse hook will enforce. Call when the user asks to add/register/block a new pattern, ban a command, or extend danger-patterns \u2014 e.g. '\uD328\uD134 \uCD94\uAC00\uD574\uC918', 'sudo \uB9C9\uC544\uC918', '\uC774\uB7F0 \uBA85\uB839\uB3C4 \uCC28\uB2E8\uB418\uAC8C \uD574\uC918'. id must be unique across both system and user patterns; regex must compile. Persisted to ${getUserPatternsPath()} (JSONC) and effective on the next hook invocation.`,
    inputSchema: {
      id: z9.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumeric + hyphen"),
      regex: z9.string().min(1),
      reason: z9.string().min(1)
    }
  }, async (input) => {
    try {
      const saved = addUserPattern(input);
      return textResult9(`Added user pattern \`${saved.id}\`.
regex: ${saved.regex}
reason: ${saved.reason}`);
    } catch (e) {
      if (e instanceof PatternValidationError) {
        return textResult9(`Rejected: ${e.message}`, true);
      }
      throw e;
    }
  });
  server.registerTool("update_user_pattern", {
    title: "Update user danger pattern",
    description: "Modify regex or reason of an existing user pattern. Call when the user asks to edit/change/\uC218\uC815 a pattern by id \u2014 e.g. 'no-sudo \uD328\uD134 reason \uBC14\uAFD4\uC918', 'regex \uC218\uC815\uD574\uC918'. System patterns cannot be modified; attempts are rejected. Pass only the fields you want to change.",
    inputSchema: {
      id: z9.string().min(1),
      regex: z9.string().min(1).optional(),
      reason: z9.string().min(1).optional()
    }
  }, async ({ id, regex, reason }) => {
    if (regex === void 0 && reason === void 0) {
      return textResult9("Rejected: provide at least one of `regex` or `reason` to update.", true);
    }
    try {
      const saved = updateUserPattern(id, { regex, reason });
      return textResult9(`Updated user pattern \`${saved.id}\`.
regex: ${saved.regex}
reason: ${saved.reason}`);
    } catch (e) {
      if (e instanceof PatternValidationError) {
        return textResult9(`Rejected: ${e.message}`, true);
      }
      throw e;
    }
  });
  server.registerTool("remove_user_pattern", {
    title: "Remove user danger pattern",
    description: "Delete an existing user pattern by id. Call when the user asks to remove/\uC0AD\uC81C/\uC81C\uAC70/\uCDE8\uC18C a pattern \u2014 e.g. 'no-sudo \uD328\uD134 \uC0AD\uC81C\uD574\uC918', '\uB0B4\uAC00 \uCD94\uAC00\uD55C \uAC70 \uBE7C\uC918'. System patterns cannot be removed; attempts are rejected.",
    inputSchema: { id: z9.string().min(1) }
  }, async ({ id }) => {
    try {
      removeUserPattern(id);
      return textResult9(`Removed user pattern \`${id}\`.`);
    } catch (e) {
      if (e instanceof PatternValidationError) {
        return textResult9(`Rejected: ${e.message}`, true);
      }
      throw e;
    }
  });
  server.registerTool("create_stepup_session", {
    title: "Create Step-up MFA Session",
    description: "Open a Transcodes step-up MFA session. Returns sid and the browser URL the user must visit to complete WebAuthn. The same flow is used by the PreToolUse hook when a danger command is detected.",
    inputSchema: {
      comment: z9.string().min(1).describe("One short sentence shown on the step-up screen explaining the reason."),
      action: z9.string().optional().describe("Action identifier for the audit log."),
      resource: z9.string().optional().describe("Protected resource identifier for the audit log."),
      member_id: z9.string().optional().describe("Member public id to authenticate. Defaults to the mid claim in TRANSCODES_TOKEN.")
    }
  }, async ({ comment, action, resource, member_id }) => {
    const config = loadStepupConfig();
    const result = await createStepupSession(config, {
      comment,
      action,
      resource,
      member_id
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: result.envelope.ok,
            status: result.envelope.status,
            sid: result.sid,
            browser_url: result.browserUrl,
            expires_at: result.expiresAt,
            raw: result.envelope.data
          }, null, 2)
        }
      ]
    };
  });
  server.registerTool("poll_stepup_session", {
    title: "Poll Step-up MFA Session",
    description: "Single GET against the step-up backend. Returns status 'pending' or 'verified'. On verified the result is cached cross-platform so a subsequent danger command in the hook can pass without re-prompting. Prefer `poll_stepup_session_wait` for the deny-recovery loop \u2014 it blocks until verified in one call instead of requiring 60 manual iterations.",
    inputSchema: {
      sid: z9.string().min(1).describe("Session id returned from create_stepup_session.")
    }
  }, async ({ sid }) => {
    const config = loadStepupConfig();
    const result = await pollStepupSession(config, sid);
    if (result.status === "verified") {
      writeVerified({ sid, verifiedAt: Date.now() });
      markVerified(sid);
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: result.envelope.ok,
            status: result.envelope.status,
            step_status: result.status,
            raw: result.envelope.data
          }, null, 2)
        }
      ]
    };
  });
  server.registerTool("poll_stepup_session_wait", {
    title: "Wait for Step-up MFA Session",
    description: 'Block until the step-up session reaches `verified` or the wait window elapses (default 60s, polling every 1s). Use this \u2014 NOT the single-shot `poll_stepup_session` \u2014 as the next action after a PreToolUse deny carrying a step-up sid. One call replaces the 60-iteration polling loop. On `outcome: "verified"` retry the original Bash command; on `outcome: "timeout"` ask the user to complete WebAuthn and call this tool again. Do NOT ask the user to confirm completion before calling this tool \u2014 it waits on the user\'s behalf.',
    inputSchema: {
      sid: z9.string().min(1).describe("Session id returned from create_stepup_session."),
      max_wait_ms: z9.number().int().positive().max(3e5).optional().describe("Maximum time to wait in ms. Defaults to 60_000."),
      interval_ms: z9.number().int().positive().max(1e4).optional().describe("Polling interval in ms. Defaults to 1_000.")
    }
  }, async ({ sid, max_wait_ms, interval_ms }) => {
    const config = loadStepupConfig();
    const result = await pollStepupSessionWait(config, sid, {
      maxWaitMs: max_wait_ms,
      intervalMs: interval_ms
    });
    if (result.outcome === "verified") {
      writeVerified({ sid, verifiedAt: Date.now() });
      markVerified(sid);
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: result.envelope.ok,
            outcome: result.outcome,
            attempts: result.attempts,
            elapsed_ms: result.elapsedMs,
            raw: result.envelope.data
          }, null, 2)
        }
      ]
    };
  });
  server.registerTool("inspect_stepup_state", {
    title: "Inspect step-up state on disk",
    description: "Single source of truth for what the step-up state files look like RIGHT NOW. Returns structured JSON for verified / pending / browser-lock records with explicit `age_ms`, `expired`, and `ttl_ms` fields so the agent never has to compute expiry from raw timestamps or trust a wrapped `ls` output. Strict read-only: this tool never consumes or rewrites any record. Call this BEFORE and AFTER any step-up flow to verify state transitions deterministically.",
    inputSchema: {}
  }, async () => {
    const snapshot = inspectStepupState();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(snapshot, null, 2)
        }
      ]
    };
  });
  server.registerTool("get_tracker_status", {
    title: "Get ai-action-tracker gate status",
    description: `Report whether the ai-action-tracker step-up gate is currently enabled, plus the active token source and its expiry. Read-only. Call when the user asks if the tracker/hook/protection is on or off \u2014 e.g. '\uD2B8\uB798\uCEE4 \uCF1C\uC838 \uC788\uC5B4?', 'hook \uD65C\uC131\uD654 \uC0C1\uD0DC\uC57C?', 'is the gate enabled?'. The enabled flag lives in the same file as the token (${transcodesConfigFile()}); a missing flag means enabled.`,
    inputSchema: {}
  }, async () => {
    const enabled = isTrackerEnabled();
    const { token, source } = resolveToken();
    let tokenSummary = null;
    if (token) {
      try {
        const parsed = parseMemberAccessToken(token);
        tokenSummary = `member=${parsed.claims.memberId} project=${parsed.claims.projectId} expires=${new Date(parsed.claims.exp * 1e3).toISOString()}`;
      } catch {
        tokenSummary = "present but undecodable";
      }
    }
    return textResult9(JSON.stringify({
      enabled,
      config_file: transcodesConfigFile(),
      token_source: source,
      token: tokenSummary
    }, null, 2));
  });
  server.registerTool("set_tracker_enabled", {
    title: "Re-enable the ai-action-tracker gate",
    description: `Re-ENABLE the ai-action-tracker step-up gate across all hosts. This tool can only turn protection ON \u2014 it deliberately REFUSES \`enabled=false\`. Disabling the gate is a privilege reduction that must be a human, out-of-band action (the agent could otherwise disable its own guardrails via prompt injection), so disabling is only possible by running \`transcodes disable\` in a terminal. Call this when the user asks to turn the tracker/hook/protection back ON \u2014 e.g. '\uD2B8\uB798\uCEE4 \uB2E4\uC2DC \uCF1C\uC918', 'enable the gate', 'turn protection back on'. Persists to ${transcodesConfigFile()}; effective on the next hook invocation (no restart needed).`,
    inputSchema: {
      enabled: z9.boolean().describe("Must be true. This tool only re-enables the gate; pass true to turn protection on. false is refused \u2014 disable via `transcodes disable` in a terminal.")
    }
  }, async ({ enabled }) => {
    if (!enabled) {
      return textResult9("Refused: the gate cannot be disabled through an MCP tool \u2014 that would let an agent switch off its own step-up protection. To disable, the human operator must run `transcodes disable` in a terminal (out-of-band from this agent).", true);
    }
    try {
      setTrackerEnabled(true);
    } catch (e) {
      return textResult9(`Failed to enable gate: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    return textResult9("ai-action-tracker gate ENABLED. Danger commands and protected MCP tools will require step-up MFA again.");
  });
  server.registerTool("simulate_hook_invocation", {
    title: "Invoke PreToolUse hook in a controlled subprocess",
    description: "Spawns the actual PreToolUse hook binary with a Bash payload as stdin, captures stdout/stderr/exit, and diffs the step-up state files before/after \u2014 all in one structured response. Use this when you need to verify hook behaviour (fast-path consumption, deny emission, new step-up start) without inferring from `exit 127` or `ls` output. WARNING: this is NOT a dry run \u2014 the hook may consume the verified record or create a new step-up session and open a browser tab if a danger pattern is hit. Use it the way you would a real hook invocation, not as a side-effect-free probe.",
    inputSchema: {
      command: z9.string().min(1).optional().describe("Bash command string. Builds tool_input={command} when tool_name is Bash and tool_input is not provided. Ignored if tool_input is set."),
      cwd: z9.string().optional().describe("Optional working directory passed to the hook payload. Defaults to process.cwd()."),
      tool_name: z9.string().min(1).optional().describe("Tool name to put in the PreToolUse payload. Defaults to 'Bash'. For MCP tool simulation use the wire name, e.g. 'mcp__plugin_ai-action-tracker_ai-action-tracker__retire_member'."),
      tool_input: z9.unknown().optional().describe("Raw tool_input object. Overrides the {command}-based default. Use for MCP tool simulation.")
    }
  }, async ({ command, cwd, tool_name, tool_input }) => {
    const effectiveToolName = tool_name ?? "Bash";
    const effectiveToolInput = tool_input !== void 0 ? tool_input : command !== void 0 ? { command } : {};
    if (effectiveToolName === "Bash" && !effectiveToolInput?.command) {
      return textResult9("Rejected: Bash payload requires `command` (or `tool_input.command`).", true);
    }
    const before = inspectStepupState();
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT?.trim() || process.env.PLUGIN_ROOT?.trim();
    if (!pluginRoot) {
      return textResult9("Rejected: CLAUDE_PLUGIN_ROOT (or PLUGIN_ROOT for Codex) must be set so the hook binary can be located.", true);
    }
    const hookPath = path.resolve(pluginRoot, "dist/hooks/pre-tool-use.js");
    const payload = JSON.stringify({
      tool_name: effectiveToolName,
      tool_input: effectiveToolInput,
      cwd: cwd ?? process.cwd()
    });
    const { stdout, stderr, exitCode } = await new Promise((resolve) => {
      const child = childSpawn("node", [hookPath], {
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout2 = "";
      let stderr2 = "";
      child.stdout.on("data", (b) => stdout2 += b.toString("utf8"));
      child.stderr.on("data", (b) => stderr2 += b.toString("utf8"));
      child.on("close", (code) => resolve({ stdout: stdout2, stderr: stderr2, exitCode: code ?? -1 }));
      child.on("error", () => resolve({ stdout: stdout2, stderr: stderr2, exitCode: -1 }));
      child.stdin.end(payload);
    });
    const after = inspectStepupState();
    let parsedStdout = null;
    try {
      parsedStdout = stdout.trim() ? JSON.parse(stdout) : null;
    } catch {
    }
    const denyEmitted = parsedStdout !== null && typeof parsedStdout === "object" && parsedStdout.hookSpecificOutput !== void 0 && parsedStdout.hookSpecificOutput.permissionDecision === "deny";
    const verifiedConsumed = before.verified.exists && !after.verified.exists;
    const pendingCleared = before.pending.exists && !after.pending.exists;
    const newPendingStarted = !before.pending.exists || before.pending.exists && after.pending.exists && before.pending.sid !== after.pending.sid ? after.pending.exists : false;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            fast_path_taken: verifiedConsumed && !denyEmitted,
            deny_emitted: denyEmitted,
            new_step_up_started: newPendingStarted && denyEmitted,
            verified_consumed: verifiedConsumed,
            pending_cleared: pendingCleared,
            exit_code: exitCode,
            stdout_json: parsedStdout,
            stdout_raw: parsedStdout === null ? stdout : void 0,
            stderr: stderr || void 0,
            state_before: before,
            state_after: after
          }, null, 2)
        }
      ]
    };
  });
  server.registerTool("echo", {
    title: "Echo",
    description: "Echoes the given message back to the caller.",
    inputSchema: { message: z9.string() }
  }, async ({ message }) => ({
    content: [{ type: "text", text: `Echo: ${message}` }]
  }));
  server.registerPrompt("greeting", {
    title: "Greeting",
    description: "Generate a greeting addressed to the given name.",
    argsSchema: { name: z9.string() }
  }, ({ name }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Hello ${name}!` }
      }
    ]
  }));
  registerMemberTools(server);
  registerRbacTools(server);
  registerPasscodeTools(server);
  registerProjectTools(server);
  registerAuditTools(server);
  registerAuthDeviceTools(server);
  registerMembershipTools(server);
  registerMetaTools(server);
  registerOrganizationTools(server);
  registerJwkTools(server);
  server.registerResource("tool-rules", "tool-rules://list", {
    title: "Step-up-protected MCP tool rules",
    description: `Tool-name rules that the PreToolUse hook uses to enforce step-up MFA on MCP tool calls. Merges immutable system rules (hooks/tool-rules.json) with user rules (${getUserToolRulesPath()}, JSONC), read fresh at every request.`,
    mimeType: "text/markdown"
  }, async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: formatToolRulesMarkdown(loadMergedToolRules())
      }
    ]
  }));
  server.registerTool("add_tool_rule", {
    title: "Add user MCP tool-rule",
    description: `Register a new user-owned tool-rule that the PreToolUse hook enforces (deny + step-up + retry) when a matching MCP tool is called. id must be unique across system and user rules; persisted to ${getUserToolRulesPath()} (JSONC).`,
    inputSchema: {
      id: z9.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumeric + hyphen"),
      toolName: z9.string().min(1),
      reason: z9.string().min(1),
      stepupAction: z9.string().min(1),
      stepupResource: z9.string().min(1),
      consume_in_hook: z9.boolean().optional().describe("When true (default for user rules), the PreToolUse hook consumes the verified record itself (Bash-like fast-path). Set false ONLY if the tool handler threads the sid via `withStepupVerifiedSid` to a backend that requires the X-Step-Up-Session-Id header.")
    }
  }, async (input) => {
    try {
      const saved = addUserToolRule(input);
      return textResult9(`Added user tool-rule \`${saved.id}\`.
toolName: ${saved.toolName}
reason: ${saved.reason}
action: ${saved.stepupAction}
resource: ${saved.stepupResource}
consume_in_hook: ${saved.consume_in_hook ?? true}`);
    } catch (e) {
      if (e instanceof ToolRuleValidationError) {
        return textResult9(`Rejected: ${e.message}`, true);
      }
      throw e;
    }
  });
  server.registerTool("update_tool_rule", {
    title: "Update user MCP tool-rule",
    description: "Modify fields of an existing user tool-rule. System rules cannot be modified.",
    inputSchema: {
      id: z9.string().min(1),
      toolName: z9.string().min(1).optional(),
      reason: z9.string().min(1).optional(),
      stepupAction: z9.string().min(1).optional(),
      stepupResource: z9.string().min(1).optional(),
      consume_in_hook: z9.boolean().optional().describe("Override the hook-side consume behavior. true = hook consumes immediately (no wrapper needed); false = handler consumes via withStepupVerifiedSid.")
    }
  }, async ({ id, toolName, reason, stepupAction, stepupResource, consume_in_hook }) => {
    if (toolName === void 0 && reason === void 0 && stepupAction === void 0 && stepupResource === void 0 && consume_in_hook === void 0) {
      return textResult9("Rejected: provide at least one of `toolName`, `reason`, `stepupAction`, `stepupResource`, or `consume_in_hook` to update.", true);
    }
    try {
      const saved = updateUserToolRule(id, {
        toolName,
        reason,
        stepupAction,
        stepupResource,
        consume_in_hook
      });
      return textResult9(`Updated user tool-rule \`${saved.id}\`.
toolName: ${saved.toolName}
reason: ${saved.reason}
action: ${saved.stepupAction}
resource: ${saved.stepupResource}
consume_in_hook: ${saved.consume_in_hook ?? true}`);
    } catch (e) {
      if (e instanceof ToolRuleValidationError) {
        return textResult9(`Rejected: ${e.message}`, true);
      }
      throw e;
    }
  });
  server.registerTool("remove_tool_rule", {
    title: "Remove user MCP tool-rule",
    description: "Delete an existing user tool-rule by id. System rules cannot be removed.",
    inputSchema: { id: z9.string().min(1) }
  }, async ({ id }) => {
    try {
      removeUserToolRule(id);
      return textResult9(`Removed user tool-rule \`${id}\`.`);
    } catch (e) {
      if (e instanceof ToolRuleValidationError) {
        return textResult9(`Rejected: ${e.message}`, true);
      }
      throw e;
    }
  });
  server.registerTool("simulate_tool_call", {
    title: "Simulate a tool-rule lookup",
    description: "Given a tool_name (and optional tool_input), report whether any system or user tool-rule matches. Read-only \u2014 does not invoke the hook or call the backend. Use to verify a rule's coverage before relying on it.",
    inputSchema: {
      tool_name: z9.string().min(1),
      tool_input: z9.unknown().optional()
    }
  }, async ({ tool_name }) => {
    const rules = loadMergedToolRules();
    const match = findFirstToolRule(tool_name, rules);
    if (!match) {
      return textResult9(JSON.stringify({ tool_name, matched: false, rule_count: rules.length }, null, 2));
    }
    const r = match.matched;
    return textResult9(JSON.stringify({
      tool_name,
      matched: true,
      rule: {
        id: r.id,
        source: r.source,
        toolName: r.toolName,
        reason: r.reason,
        stepupAction: r.stepupAction,
        stepupResource: r.stepupResource
      }
    }, null, 2));
  });
  return server;
}

// src/stdio.ts
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ai-action-tracker-mcp: stdio transport ready (cursor)");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
