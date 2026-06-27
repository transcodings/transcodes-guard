/**
 * Single source of truth for every MCP tool + resource registered in createServer().
 *
 * Consumed by:
 *   - scripts/router-body.mjs → TOOL CATALOG section in /transcodes command files
 *   - scripts/generate-router-files.mjs → cli/src/tool-catalog.generated.ts
 *
 * When adding/removing a registerTool() or registerResource() in mcp-server-core or
 * transcodes-mcp-tools, update this file and run `node scripts/generate-router-files.mjs`.
 */

/** @typedef {'api' | 'console-only' | 'gate'} ToolAccess */

/** Display order for TOOL CATALOG sections. */
export const CATEGORY_ORDER = [
  'Gate & Policies',
  'Meta & Identity',
  'Project',
  'Members',
  'RBAC',
  'Passcode',
  'Auth Devices',
  'Audit',
  'Membership',
  'Platform users',
  'JWK',
];

/** @type {{uri: string, description: string}[]} */
export const MCP_RESOURCES = [
  {
    uri: 'version://info',
    description:
      'Returns the running plugin version. Use to confirm which build is loaded.',
  },
  {
    uri: 'danger-patterns://list',
    description:
      'Regex patterns the PreToolUse hook uses to block dangerous Bash commands.',
  },
  {
    uri: 'tool-rules://list',
    description:
      'Tool-name rules the PreToolUse hook enforces on MCP tool calls.',
  },
];

/** @type {{name: string, description: string, category: string, access: ToolAccess, stepUpProtected: boolean, mutating: boolean}[]} */
export const MCP_TOOLS = [
  // ── Gate & Policies ────────────────────────────────────────────────
  {
    name: 'simulate_command',
    description:
      'Check whether a Bash command would match danger-patterns before it hits the hook.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'simulate_tool_call',
    description:
      'Check whether an MCP tool name would match tool-rules before calling it.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'add_user_pattern',
    description:
      'Register a user-owned Bash regex pattern the PreToolUse hook enforces.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'update_user_pattern',
    description: 'Modify regex or reason of an existing user Bash pattern.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'add_tool_rule',
    description:
      'Register a user-owned MCP tool rule for step-up MFA on tool calls.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'update_tool_rule',
    description: 'Modify an existing user MCP tool rule.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'refresh_rules',
    description:
      'Force-refresh the org policy bundle cache and return active tool rules.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'create_stepup_session',
    description:
      'Open a WebAuthn step-up session; returns sid and browser URL.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'poll_stepup_session',
    description:
      'Single-shot poll of step-up session status (pending or verified).',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'poll_stepup_session_wait',
    description:
      'Block until step-up reaches verified or timeout — use after a hook deny.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'inspect_stepup_state',
    description:
      'Read-only snapshot of verified, pending, and browser-lock state files.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'simulate_hook_invocation',
    description:
      'Spawn the real hook binary and diff step-up state before/after.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'echo',
    description: 'Health-check tool that echoes a message back to the caller.',
    category: 'Gate & Policies',
    access: 'gate',
    stepUpProtected: false,
    mutating: false,
  },

  // ── Meta & Identity ────────────────────────────────────────────────
  {
    name: 'get_current_project_id',
    description: 'Returns project ID parsed from TRANSCODES_TOKEN.',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'get_current_organization_id',
    description: 'Returns organizationId from TRANSCODES_TOKEN JWT.',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'get_current_member_id',
    description: 'Returns memberId from TRANSCODES_TOKEN JWT.',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'get_my_profile',
    description: 'Profile of the member identified by TRANSCODES_TOKEN.',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'get_console_url',
    description:
      'Mint a step-up-protected console URL for browser-only actions (passkeys, TOTP, billing portal).',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'get_integration_guide',
    description: 'Fetch the official Transcodes integration guide (llms.txt).',
    category: 'Meta & Identity',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },

  // ── Project ────────────────────────────────────────────────────────
  {
    name: 'get_project',
    description:
      'Fetch the active project (fixed by TRANSCODES_TOKEN pid claim).',
    category: 'Project',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'check_project_assets',
    description:
      'Separate auth SDK webworker status from optional manifest/sw.js install assets.',
    category: 'Project',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'check_related_origin',
    description:
      'Check whether a redirect_uri/origin is registered in project authentication.related_origins.',
    category: 'Project',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'project_pwa_auth_console',
    description:
      'Auth and console configuration must be done in the Transcodes console.',
    category: 'Project',
    access: 'console-only',
    stepUpProtected: false,
    mutating: false,
  },

  // ── Members ────────────────────────────────────────────────────────
  {
    name: 'get_member',
    description: 'Get one member profile by member_id or email.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'list_members_paginated',
    description: 'Paginated member list with sort options.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'list_member_devices',
    description: 'Passkeys, authenticators, and TOTP devices for a member.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'get_member_suspension',
    description: 'Check whether a member is currently suspended.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'create_member',
    description: 'Create a member for onboarding or manual provisioning.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'update_member',
    description:
      'Update member profile fields (name, email, metadata). Use update_member_role to change a role.',
    category: 'Members',
    access: 'api',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'retire_member',
    description: 'Permanently delete a member — irreversible kill switch.',
    category: 'Members',
    access: 'api',
    stepUpProtected: true,
    mutating: true,
  },
  {
    name: 'suspend_member',
    description:
      'Temporarily suspend a member; blocks login and invalidates sessions.',
    category: 'Members',
    access: 'api',
    stepUpProtected: true,
    mutating: true,
  },
  {
    name: 'unsuspend_member',
    description: 'Lift a member suspension and restore login ability.',
    category: 'Members',
    access: 'api',
    stepUpProtected: true,
    mutating: true,
  },

  // ── RBAC ───────────────────────────────────────────────────────────
  {
    name: 'get_roles',
    description: 'List all roles and permission matrix for the project.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'get_resources',
    description: 'List RBAC resource keys for the project.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'check_rbac_permission',
    description: 'Simulate whether a member may access a resource+action.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'create_role',
    description: 'Create a new role before setting permissions.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'update_role',
    description: 'Update role metadata (description).',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'create_resource',
    description:
      'Add a new RBAC resource key (every role initialized to read=allow, write=allow+step-up).',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'update_resource',
    description: 'Update resource label/description.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: false,
    mutating: true,
  },
  {
    name: 'retire_role',
    description: 'Permanently retire a role from the project.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: true,
    mutating: true,
  },
  {
    name: 'set_role_permissions',
    description:
      'Set per-resource permission matrix for a role (0=deny, 1=allow, 2=step-up).',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: true,
    mutating: true,
  },
  {
    name: 'update_member_role',
    description: "Change a member's assigned role (validates the role exists).",
    category: 'RBAC',
    access: 'api',
    stepUpProtected: true,
    mutating: true,
  },
  {
    name: 'retire_resource',
    description: 'Permanently retire an RBAC resource key.',
    category: 'RBAC',
    access: 'api',
    stepUpProtected: true,
    mutating: true,
  },

  // ── Passcode ───────────────────────────────────────────────────────
  {
    name: 'passcode_create',
    description:
      'Create a recovery passcode for a member (support/onboarding).',
    category: 'Passcode',
    access: 'api',
    stepUpProtected: true,
    mutating: true,
  },

  // ── Auth Devices ───────────────────────────────────────────────────
  {
    name: 'list_authenticators',
    description: 'List WebAuthn authenticators for a member.',
    category: 'Auth Devices',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'list_passkeys',
    description: 'List passkeys for a member.',
    category: 'Auth Devices',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'list_totps',
    description: 'List TOTP devices for a member.',
    category: 'Auth Devices',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },

  // ── Audit ──────────────────────────────────────────────────────────
  {
    name: 'get_security_logs',
    description: 'Paginated project audit logs with tag and date filters.',
    category: 'Audit',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },

  // ── Membership ─────────────────────────────────────────────────────
  {
    name: 'membership_plans',
    description:
      'List available Transcodes membership plans and Stripe metadata.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'membership_plans_limits',
    description: 'Resource limits enforced per plan tier.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'membership_customer_status_by_project',
    description:
      'Subscription status for the organization owning the token project.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'membership_customer_status_by_organization',
    description: 'Subscription status for the token organization.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'membership_create_checkout_session',
    description:
      'Create a Stripe Checkout session for plan upgrade or purchase.',
    category: 'Membership',
    access: 'api',
    stepUpProtected: false,
    mutating: true,
  },

  // ── Platform users ─────────────────────────────────────────────────
  {
    name: 'user_get_current',
    description:
      'Returns the currently authenticated platform user (Firebase/console account).',
    category: 'Platform users',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'user_find',
    description: 'Find platform users by comma-separated ids or emails.',
    category: 'Platform users',
    access: 'api',
    stepUpProtected: false,
    mutating: false,
  },
  {
    name: 'user_create',
    description: 'User creation must be done in the Transcodes console.',
    category: 'Platform users',
    access: 'console-only',
    stepUpProtected: false,
    mutating: false,
  },

  // ── JWK ────────────────────────────────────────────────────────────
  {
    name: 'jwk_backup',
    description: 'JWK backup must be done in the Transcodes console.',
    category: 'JWK',
    access: 'console-only',
    stepUpProtected: false,
    mutating: false,
  },
];

/** @param {(typeof MCP_TOOLS)[number]} tool */
function toolTag(tool) {
  if (tool.access === 'console-only') return ' [console-only]';
  if (tool.stepUpProtected) return ' [mutating · step-up protected]';
  if (tool.mutating) return ' [mutating]';
  return ' [read-only]';
}

/**
 * Render the TOOL CATALOG appendix appended to every /transcodes command body.
 * @param {typeof MCP_TOOLS} tools
 * @param {typeof MCP_RESOURCES} resources
 */
export function renderToolCatalogSection(tools, resources) {
  const byCategory = new Map();
  for (const tool of tools) {
    const list = byCategory.get(tool.category) ?? [];
    list.push(tool);
    byCategory.set(tool.category, list);
  }

  const lines = [
    '',
    `TOOL CATALOG — all ${tools.length} MCP tools + ${resources.length} resources on transcodes-guard. Match the user request to a workflow MENU item above OR to an exact tool/resource below, then call it by its exact name.`,
    '',
    'Resources (read by URI, not tools):',
  ];
  for (const resource of resources) {
    lines.push(`- \`${resource.uri}\` — ${resource.description}`);
  }

  let index = 1;
  for (const category of CATEGORY_ORDER) {
    const items = byCategory.get(category);
    if (!items?.length) continue;
    lines.push('', `${category} (${items.length}):`);
    for (const tool of items) {
      lines.push(`${index}) \`${tool.name}\` — ${tool.description}${toolTag(tool)}`);
      index += 1;
    }
  }

  return lines.join('\n');
}
