/**
 * Read-only catalog of every MCP tool registered in createServer().
 * Used only by the transcodes CLI dashboard.
 *
 * SYNC: this is a hand-maintained mirror of the registerTool() calls in
 * @transcodes-guard/mcp-server-core (server.ts + transcodes-mcp-tools'
 * register*Tools). It lives here because the CLI is its sole consumer, but
 * it is NOT auto-derived — when a tool is added/changed/removed in
 * mcp-server-core, update this catalog in the same change or the dashboard
 * drifts.
 */
export type AdminToolAccess = 'api' | 'console-only' | 'gate';

export type AdminToolEntry = {
  /** Short registerTool name (e.g. get_member). */
  name: string;
  /** Human title from registerTool metadata. */
  title: string;
  /** One-line summary for dashboard cards. */
  description: string;
  category: string;
  access: AdminToolAccess;
  /** PreToolUse step-up enforced via system tool-rules.json. */
  stepUpProtected: boolean;
};

/** Claude Code wire prefix for this plugin's MCP tools. */
export const TRANSCODES_MCP_PREFIX =
  'mcp__plugin_transcodes-guard_transcodes-guard__';

export function mcpWireName(toolName: string): string {
  return `${TRANSCODES_MCP_PREFIX}${toolName}`;
}

/** All Transcodes Admin MCP tools, grouped for display. */
export const TRANSCODES_ADMIN_TOOLS: AdminToolEntry[] = [
  // ── Gate & plugin control ──────────────────────────────────────────
  {
    name: 'simulate_command',
    title: 'Simulate command against block patterns',
    description:
      'Check whether a Bash command would match danger-patterns before it hits the hook.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'add_user_pattern',
    title: 'Add user danger pattern',
    description:
      'Register a user-owned Bash regex pattern the PreToolUse hook enforces.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'update_user_pattern',
    title: 'Update user danger pattern',
    description: 'Modify regex or reason of an existing user Bash pattern.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'add_tool_rule',
    title: 'Add user MCP tool-rule',
    description:
      'Register a user-owned MCP tool rule for step-up MFA on tool calls.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'update_tool_rule',
    title: 'Update user MCP tool-rule',
    description: 'Modify an existing user MCP tool rule.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'refresh_rules',
    title: 'Refresh rules from the Transcodes backend',
    description:
      'Force-refresh the org policy bundle cache NOW and return the currently active tool rules.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'simulate_tool_call',
    title: 'Simulate MCP tool against tool-rules',
    description:
      'Check whether an MCP tool name would match tool-rules before calling it.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'create_stepup_session',
    title: 'Create Step-up MFA Session',
    description:
      'Open a WebAuthn step-up session; returns sid and browser URL.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'poll_stepup_session',
    title: 'Poll Step-up MFA Session',
    description:
      'Single-shot poll of step-up session status (pending or verified).',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'poll_stepup_session_wait',
    title: 'Wait for Step-up MFA Session',
    description:
      'Block until step-up reaches verified or timeout — use after a hook deny.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'inspect_stepup_state',
    title: 'Inspect step-up state on disk',
    description:
      'Read-only snapshot of verified, pending, and browser-lock state files.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'simulate_hook_invocation',
    title: 'Invoke PreToolUse hook in a controlled subprocess',
    description:
      'Spawn the real hook binary and diff step-up state before/after.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },
  {
    name: 'echo',
    title: 'Echo',
    description: 'Health-check tool that echoes a message back to the caller.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
  },

  // ── Meta & identity ────────────────────────────────────────────────
  {
    name: 'get_current_project_id',
    title: 'Get current project id',
    description: 'Returns project ID parsed from TRANSCODES_TOKEN.',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'get_current_organization_id',
    title: 'Get current organization id',
    description: 'Returns organizationId from TRANSCODES_TOKEN JWT.',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'get_current_member_id',
    title: 'Get current member id',
    description: 'Returns memberId from TRANSCODES_TOKEN JWT.',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'get_my_profile',
    title: 'Get my profile',
    description: 'Profile of the member identified by TRANSCODES_TOKEN.',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'get_console_url',
    title: 'Get console URL',
    description:
      'Mint a step-up-protected console URL for browser-only actions (passkeys, TOTP, billing portal).',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'get_integration_guide',
    title: 'Get integration guide',
    description: 'Fetch the official Transcodes integration guide (llms.txt).',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
  },

  // ── Project ────────────────────────────────────────────────────────
  {
    name: 'get_project',
    title: 'Get project',
    description:
      'Fetch the active project (fixed by TRANSCODES_TOKEN pid claim).',
    category: 'Project',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'check_project_assets',
    title: 'Check project CDN assets',
    description:
      'Separate auth SDK webworker status from optional manifest/sw.js install assets.',
    category: 'Project',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'check_related_origin',
    title: 'Check sign-in related origin',
    description:
      'Check whether a redirect_uri/origin is registered in project authentication.related_origins.',
    category: 'Project',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'project_pwa_auth_console',
    title: 'Auth config (console-only)',
    description:
      'Blocked — Auth and console configuration must be done in the Transcodes console.',
    category: 'Project',
    access: 'console-only',
    stepUpProtected: false,
  },

  // ── Members ────────────────────────────────────────────────────────
  {
    name: 'get_member',
    title: 'Get member',
    description: 'Get one member profile by member_id or email.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'list_members_paginated',
    title: 'List members (paginated)',
    description: 'Paginated member list with sort options.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'list_member_devices',
    title: 'List member devices',
    description: 'Passkeys, authenticators, and TOTP devices for a member.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'get_member_suspension',
    title: 'Get member suspension status',
    description: 'Check whether a member is currently suspended.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'create_member',
    title: 'Create member',
    description: 'Create a member for onboarding or manual provisioning.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'update_member',
    title: 'Update member',
    description:
      'Update member profile fields (name, email, metadata). Use update_member_role to change a role.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'retire_member',
    title: 'Retire member (permanent)',
    description: 'Permanently delete a member — irreversible kill switch.',
    category: 'Members',
    access: 'api',
    stepUpProtected: true,
  },
  {
    name: 'suspend_member',
    title: 'Suspend member (reversible)',
    description:
      'Temporarily suspend a member; blocks login and invalidates sessions.',
    category: 'Members',
    access: 'api',
    stepUpProtected: true,
  },
  {
    name: 'unsuspend_member',
    title: 'Unsuspend member',
    description: 'Lift a member suspension and restore login ability.',
    category: 'Members',
    access: 'api',
    stepUpProtected: true,
  },

  // ── RBAC ───────────────────────────────────────────────────────────
  {
    name: 'get_roles',
    title: 'Get roles',
    description: 'List all roles and permission matrix for the project.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'get_resources',
    title: 'Get resources',
    description: 'List RBAC resource keys for the project.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'check_rbac_permission',
    title: 'Check RBAC permission',
    description: 'Simulate whether a member may access a resource+action.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'create_role',
    title: 'Create role',
    description: 'Create a new role before setting permissions.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'update_role',
    title: 'Update role',
    description: 'Update role metadata (description).',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'create_resource',
    title: 'Create resource',
    description:
      'Add a new RBAC resource key (every role initialized to read=allow, write=allow+step-up).',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'update_resource',
    title: 'Update resource',
    description: 'Update resource label/description.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'retire_role',
    title: 'Retire role',
    description: 'Permanently retire a role from the project.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: true,
  },
  {
    name: 'set_role_permissions',
    title: 'Set role permissions',
    description:
      'Set per-resource permission matrix for a role (0=deny, 1=allow, 2=step-up).',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: true,
  },
  {
    name: 'update_member_role',
    title: 'Update member role',
    description: "Change a member's assigned role (validates the role exists).",
    category: 'RBAC',
    access: 'api',
    stepUpProtected: true,
  },
  {
    name: 'retire_resource',
    title: 'Retire resource',
    description: 'Permanently retire an RBAC resource key.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: true,
  },

  // ── Passcode ───────────────────────────────────────────────────────
  {
    name: 'passcode_create',
    title: 'Create recovery passcode',
    description:
      'Create a recovery passcode for a member (support/onboarding).',
    category: 'Passcode',
    access: 'api',
    stepUpProtected: true,
  },

  // ── Auth devices ───────────────────────────────────────────────────
  {
    name: 'list_authenticators',
    title: 'List authenticators',
    description: 'List WebAuthn authenticators for a member.',
    category: 'Auth Devices',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'list_passkeys',
    title: 'List passkeys',
    description: 'List passkeys for a member.',
    category: 'Auth Devices',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'list_totps',
    title: 'List TOTP devices',
    description: 'List TOTP devices for a member.',
    category: 'Auth Devices',
    access: 'api',
    stepUpProtected: false,
  },

  // ── Audit ──────────────────────────────────────────────────────────
  {
    name: 'get_security_logs',
    title: 'Get security logs',
    description: 'Paginated project audit logs with tag and date filters.',
    category: 'Audit',
    access: 'api',
    stepUpProtected: false,
  },

  // ── Membership / billing ───────────────────────────────────────────
  {
    name: 'membership_plans',
    title: 'Membership plans',
    description:
      'List available Transcodes membership plans and Stripe metadata.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'membership_plans_limits',
    title: 'Membership plan limits',
    description: 'Resource limits enforced per plan tier.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'membership_customer_status_by_project',
    title: 'Customer status by project',
    description:
      'Subscription status for the organization owning the token project.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'membership_customer_status_by_organization',
    title: 'Customer status by organization',
    description: 'Subscription status for the token organization.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'membership_create_checkout_session',
    title: 'Create checkout session',
    description:
      'Create a Stripe Checkout session for plan upgrade or purchase.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
  },

  // ── Platform users ───────────────────────────────────────────────────
  {
    name: 'user_get_current',
    title: 'Get current user',
    description:
      'Returns the currently authenticated platform user (Firebase/console account).',
    category: 'Platform users',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'user_find',
    title: 'Find user',
    description: 'Find platform users by comma-separated ids or emails.',
    category: 'Platform users',
    access: 'api',
    stepUpProtected: false,
  },
  {
    name: 'user_create',
    title: 'Create user (console-only)',
    description: 'Blocked — user creation in Transcodes console.',
    category: 'Platform users',
    access: 'console-only',
    stepUpProtected: false,
  },

  // ── JWK ────────────────────────────────────────────────────────────
  {
    name: 'jwk_backup',
    title: 'JWK backup (console-only)',
    description: 'Blocked — JWK backup must be done in Transcodes console.',
    category: 'JWK',
    access: 'console-only',
    stepUpProtected: false,
  },
];

export type AdminToolsPayload = {
  prefix: string;
  total: number;
  tools: Array<AdminToolEntry & { mcpToolName: string }>;
};

export function buildAdminToolsPayload(): AdminToolsPayload {
  const tools = TRANSCODES_ADMIN_TOOLS.filter((t) => t.access === 'api').map(
    (t) => ({
      ...t,
      mcpToolName: mcpWireName(t.name),
    }),
  );
  return {
    prefix: TRANSCODES_MCP_PREFIX,
    total: tools.length,
    tools,
  };
}
