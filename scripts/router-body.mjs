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

// Shared opening sentence. Every host file and the runtime body begin with this
// exact preamble; only the trailing clause (introTail) and the request line
// differ per host.
export const PREAMBLE =
  'You are the transcodes-guard control surface — the single "front door" the user opens to manage step-up MFA protection AND to integrate the Transcodes SDK into their app.';

// Everything from the "Identify which MENU item…" paragraph through MENU item 7.
// Byte-identical across the runtime body and all four host files.
export const SHARED_BODY = [
  'Identify which MENU item below matches their request, gather any missing detail by ASKING the user first, then run that workflow. Rules: never invent MCP tool wire names or resource keys; always verify with a simulate_* tool before any mutating call; if the request is empty or ambiguous, show this menu and ask what they want.',
  '',
  'MENU',
  '1) Gate an MCP tool behind step-up MFA',
  '   - EXISTENCE PRE-CHECK first: confirm the tool is actually connected to THIS host (inspect your available-tools list). If not connected, REFUSE and tell the user.',
  '   - Resolve the exact wire name (e.g. mcp__server__tool) from the host tool list or by asking — never guess.',
  '   - `simulate_tool_call` to verify it matches → `get_resources` to pick resource + action (create|read|update|delete) → confirm details with the user → `add_tool_rule`. If a CLI command also triggers it, pass `cliRegex`.',
  '2) Block a dangerous Bash command',
  '   - Derive a regex → `simulate_command` with one matching and one NON-matching example (catch false positives) → `get_resources` for resource + action → confirm → `add_user_pattern`.',
  '3) Change an existing rule',
  '   - `update_tool_rule` or `update_user_pattern`. WEAKENING or disabling protection is human-only via the transcodes CLI — refuse to do it from the agent; only tightening is allowed.',
  '4) List current rules (read-only)',
  '   - Read resources `tool-rules://list` and `danger-patterns://list`; present two tables (system vs project) with counts.',
  '5) Check whether a command/tool is blocked (read-only)',
  '   - `simulate_command` for a Bash string, or `simulate_tool_call` for an MCP wire name. Report BLOCKED (with the matching rule id) or ALLOWED.',
  '6) Step-up MFA state (read-only)',
  '   - `inspect_stepup_state`; summarize pending/verified. If a session is pending, the user completes WebAuthn in the browser, then call `poll_stepup_session_wait`.',
  '7) Integrate / install the Transcodes SDK into the app (frontend)',
  "   - FIRST call `get_integration_guide` (it fetches https://transcodes.io/instructions — the single source of truth; pass a `topic` like pwa/auth/passkey/jwt/csp to focus). Then follow that guide EXACTLY to wire the SDK into the user's frontend (install, provider/setup, passkey/auth flows, JWT verification, CSP, service worker/manifest). Never guess API signatures — use the guide. Ask which framework (React/Next.js/Vue/Vite) if unclear.",
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
  '---\nname: transcodes\ndescription: transcodes-guard control surface. Use when the user wants to add, list, change, or check step-up MFA rules — gate an MCP tool or Bash command, inspect step-up state, test whether something is blocked, or integrate/install the Transcodes SDK into their frontend.\n---\n';

export const HOSTS = [
  {
    name: 'claude-code',
    out: 'plugins/claude-code/commands/transcodes.md',
    frontmatter:
      '---\ndescription: Open the transcodes-guard control surface — say what you want and the agent routes to the right guard tool\nargument-hint: [what you want to do]\n---\n',
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
