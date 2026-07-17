import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PLUGIN_VERSION } from '../build-info.js';
import {
  type GateBackend,
  getGateBackend,
  registerToolDefinitions,
} from '../contract/index.js';
import {
  GUARD_PROTECTED_TOOL_RULES,
  type GuardProtectedToolRule,
} from '../patterns/index.js';
import { TRANSCODES_ROUTER_BODY } from './router-body.js';
import { coreToolDefinitions } from './tool-definitions.js';

export { coreToolDefinitions } from './tool-definitions.js';

// The `/transcodes` umbrella command body lives in the generated
// router-body.ts (single source: scripts/router-body.mjs), which also renders
// the four per-host command/skill markdown files — no hand-mirroring.
function transcodesRouterBody(request?: string): string {
  const trimmed = request?.trim();
  return TRANSCODES_ROUTER_BODY.replace(
    '{{REQUEST}}',
    trimmed && trimmed.length > 0
      ? trimmed
      : '(no request given — show the menu and ask what they want)',
  );
}

function formatToolRulesMarkdown(
  rules: readonly GuardProtectedToolRule[],
): string {
  const lines: string[] = [
    '# Step-up-protected MCP tool rules (system)',
    '',
    `${rules.length} system rule(s) gate built-in transcodes-guard MCP tools via the execProtectedTool handler backstop.`,
    'External mcp__* tools are gated via POST /guard/evaluate in the PreToolUse hook — not listed here.',
    '',
    '| id | tool name / pattern | description | action | resource |',
    '| -- | ------------------- | ----------- | ------ | -------- |',
  ];
  for (const r of rules) {
    lines.push(
      `| \`${r.id}\` | \`${r.name}\` | ${r.description} | ${r.action} | ${r.resource} |`,
    );
  }
  return lines.join('\n');
}

export function createServer(
  backend: GateBackend = getGateBackend(),
): McpServer {
  const server = new McpServer({
    name: 'transcodes-guard-mcp',
    version: PLUGIN_VERSION,
  });

  server.registerResource(
    'version-info',
    'version://info',
    {
      title: 'Plugin version',
      description:
        'Returns the running plugin version. Use this to confirm which build is currently loaded after an update.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ version: PLUGIN_VERSION }, null, 2),
        },
      ],
    }),
  );

  // ── /transcodes — single umbrella command (MCP prompt) ───────────────────
  // One "front door" the user opens with free-form text; the agent routes the
  // request to the right guard workflow and asks for any missing detail before
  // acting. It adds no capability — only a deterministic entrypoint that stops
  // the agent from mis-routing a natural-language request. The exact same
  // router body is mirrored in each plugin's native command/skill file for
  // hosts that don't surface MCP prompts as slash commands (Cursor/Codex/
  // Antigravity); keep them in sync (see TRANSCODES_ROUTER_BODY consumers).
  server.registerPrompt(
    'transcodes',
    {
      title: 'transcodes-guard',
      description:
        'Open the transcodes-guard control surface. Say what you want in plain language (check whether a Bash/MCP call would trigger step-up, inspect step-up state, Transcodes Admin API operations, integrate/install the SDK) and the agent routes to the right guard tool, asking for any missing detail.',
      argsSchema: { request: z.string().optional() },
    },
    ({ request }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: transcodesRouterBody(request),
          },
        },
      ],
    }),
  );

  // Core (host-agnostic) tools — one generic loop over the definition data.
  registerToolDefinitions(server, coreToolDefinitions(backend));

  server.registerPrompt(
    'tc_greeting',
    {
      title: 'Greeting',
      description: 'Generate a greeting addressed to the given name.',
      argsSchema: { name: z.string() },
    },
    ({ name }) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Hello ${name}!` },
        },
      ],
    }),
  );

  backend.registerBackendTools(server);

  server.registerResource(
    'tc_tool_rules',
    // Scheme must be WHATWG-legal (no underscore) — the MCP SDK parses the
    // URI with `new URL()` on every resources/read.
    'tc-tool-rules://list',
    {
      title: 'Step-up-protected MCP tool rules (system)',
      description:
        'Read-only list of system MCP tool-rules derived from the tool definition data (stepUp coordinates). These gate built-in transcodes-guard MCP tools via execProtectedTool — external mcp__* tools use POST /guard/evaluate instead.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: formatToolRulesMarkdown(GUARD_PROTECTED_TOOL_RULES),
        },
      ],
    }),
  );

  return server;
}
