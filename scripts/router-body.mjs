/**
 * Canonical source of truth for the `/transcodes` umbrella command body.
 *
 * The runtime MCP prompt (packages/mcp-server-core/src/server.ts) and the four
 * per-host command/skill markdown files are ALL derived from the constants
 * here — there is no hand-mirroring. Edit the menu once, run
 * `node scripts/generate-router-files.mjs` (it runs automatically via
 * `prebuild:plugin`), and every consumer regenerates.
 *
 * Consumed by scripts/generate-router-files.mjs (plain ESM — importable with
 * zero build step, which is why this is .mjs and not .ts).
 */

import {
  MCP_RESOURCES,
  MCP_TOOLS,
  renderToolCatalogSection,
} from './tool-catalog.mjs';

// Shared opening sentence. Every host file and the runtime body begin with this
// exact preamble; only the trailing clause (introTail) and the request line
// differ per host.
export const PREAMBLE =
  'You are the transcodes-guard control surface — the single "front door" the user opens to manage step-up MFA protection, Transcodes Admin API operations, AND to integrate the Transcodes SDK into their app.';

// Everything from the "Identify which MENU item…" paragraph through the last MENU item.
// Byte-identical across the runtime body and all four host files.
const WORKFLOW_MENU = [
  'Identify which MENU item below matches their request, gather any missing detail by ASKING the user first, then run that workflow.',
  '',
  'TOOL ACCESS RULES (all items):',
  '- Every tool named below lives on the `transcodes-guard` MCP server — call by exact MCP tool name (e.g. `get_member`), NOT as a slash command.',
  '- Before calling any tool, confirm `transcodes-guard` MCP is connected on THIS host. If disconnected, REFUSE and tell the user to enable/reload the plugin MCP server.',
  '- Never invent MCP tool wire names or resource keys; use `simulate_tool_call` for MCP gating checks before explaining hook behaviour to the user.',
  '- Mutating Admin API calls: confirm intent + required ids with the user first; some are RBAC-gated or step-up-protected by system tool-rules.',
  '- If the request is empty or ambiguous, show this full menu and ask what they want.',
  '',
  'MENU — Guard & SDK',
  '1) Check whether a Bash command or MCP tool call would trigger step-up (read-only)',
  '   - Bash: ALL commands reach POST /guard/evaluate in the PreToolUse hook. Call `simulate_command` with the command string.',
  '   - External mcp__* wire names are gated via POST /guard/evaluate. Built-in transcodes-guard MCP skips the hook (handler backstop only). Call `simulate_tool_call` with the full wire name from the host tool list.',
  '   - System MCP tool-rules (handler backstop): read `tool-rules://list`.',
  '2) Step-up MFA state (read-only)',
  '   - `inspect_stepup_state`; summarize pending/verified. If a session is pending, the user completes WebAuthn in the browser, then call `poll_stepup_session_wait`.',
  '3) Integrate / install the Transcodes SDK into the app (frontend)',
  "   - FIRST call `get_integration_guide` (it fetches https://transcodes.io/instructions — the single source of truth; pass a `topic` like auth/webauthn/server-jwt/csp to focus). Then follow that guide EXACTLY to wire the SDK into the user's frontend (install, provider/setup, passkey/auth flows, JWT verification, CSP, CDN webworker). Never guess API signatures — use the guide. Ask which framework (React/Next.js/Vue/Vite) if unclear.",
  '',
  'MENU — Transcodes Admin API (transcodes-guard MCP server)',
  '4) Identity & session context (read-only)',
  '   - `get_current_project_id`, `get_current_organization_id`, `get_current_member_id`, `get_my_profile`, `get_console_url`.',
  '   - Use these first when the user asks "who am I", "what project/org", or needs a console link.',
  '5) Members — inspect & lifecycle',
  '   - Read: `get_member`, `list_members_paginated`, `list_member_devices`, `get_member_suspension`.',
  '   - Mutating (confirm first): `create_member`, `update_member`, `suspend_member`, `unsuspend_member`, `retire_member`.',
  '6) RBAC — roles, resources, permissions',
  '   - Read: `get_roles`, `get_resources`, `check_rbac_permission`.',
  '   - Mutating (confirm first): `create_role`, `update_role`, `retire_role`, `set_role_permissions`, `update_member_role`, `create_resource`, `update_resource`, `retire_resource`.',
  '7) Platform users',
  '   - Read: `user_get_current`, `user_find`.',
  '   - Mutating (confirm first): `user_create` (console-only stub — direct to Transcodes console).',
  '8) Project & asset diagnostics',
  '   - `get_project`, `check_related_origin`, `check_project_assets`, `project_pwa_auth_console`.',
  '9) Membership & billing',
  '   - Read: `membership_plans`, `membership_plans_limits`, `membership_customer_status_by_project`, `membership_customer_status_by_organization`.',
  '   - Mutating (confirm first): `membership_create_checkout_session`.',
  '10) Audit, auth devices, passcode, keys',
  '   - Audit read: `get_security_logs`.',
  '   - Auth devices read: `list_authenticators`, `list_passkeys`, `list_totps`.',
  '   - Mutating (confirm first): `passcode_create`, `jwk_backup`.',
];

export const SHARED_BODY = [
  WORKFLOW_MENU.join('\n'),
  renderToolCatalogSection(MCP_TOOLS, MCP_RESOURCES),
].join('\n');

// The runtime body uses a {{REQUEST}} placeholder that transcodesRouterBody()
// substitutes at call time. server.ts imports this via the generated
// router-body.ts.
export const RUNTIME_BODY = [
  `${PREAMBLE} The user said:`,
  '',
  '> {{REQUEST}}',
  '',
  SHARED_BODY,
].join('\n');

// Per-host transform table. Each host file is rendered as:
//   frontmatter + PREAMBLE + introTail + requestBlock + '\n' + SHARED_BODY + '\n'
// frontmatter is hand-tuned per host and kept verbatim here (not generated from
// logic). cursor has none. antigravity and codex share identical frontmatter.
const SKILL_FRONTMATTER =
  '---\nname: transcodes\ndescription: transcodes-guard control surface. Use when the user wants step-up MFA rules, Transcodes Admin API (members, RBAC, org, project, audit, devices), step-up state, block checks, or Transcodes SDK integration — routes to the transcodes-guard MCP server tools.\n---\n';

export const HOSTS = [
  {
    name: 'claude-code',
    out: 'plugins/claude-code/commands/transcodes.md',
    frontmatter:
      '---\ndescription: Open the transcodes-guard control surface — step-up rules, Transcodes Admin API, SDK integration; routes to transcodes-guard MCP tools\nargument-hint: [what you want to do]\n---\n',
    introTail: ' The user said:',
    // claude-code keeps a blockquote request line (Claude Code native $ARGUMENTS).
    requestBlock: '\n\n> $ARGUMENTS',
  },
  {
    name: 'cursor',
    out: 'plugins/cursor/.cursor/commands/transcodes.md',
    frontmatter: '',
    introTail: " The user's request is the text typed after this command.",
    requestBlock: '',
  },
  {
    name: 'antigravity',
    out: 'plugins/antigravity/skills/transcodes/SKILL.md',
    frontmatter: SKILL_FRONTMATTER,
    introTail: " The user's request follows the /transcodes invocation.",
    requestBlock: '',
  },
  {
    name: 'codex',
    out: 'plugins/codex/skills/transcodes/SKILL.md',
    frontmatter: SKILL_FRONTMATTER,
    introTail: " The user's request follows the $transcodes invocation.",
    requestBlock: '',
  },
];

// Render a single host's markdown file content (with trailing newline).
export function renderHost(host) {
  return `${host.frontmatter}${PREAMBLE}${host.introTail}${host.requestBlock}\n\n${SHARED_BODY}\n`;
}
