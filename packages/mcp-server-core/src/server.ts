import { spawn as childSpawn } from 'node:child_process';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  isMcpWireToolName,
  isTranscodesGuardWireToolName,
  loadMergedToolRules,
  type MergedToolRule,
} from '@transcodes-guard/danger-patterns';
import {
  type GateBackend,
  getGateBackend,
} from '@transcodes-guard/gate-contract';
import { z } from 'zod';
import { PLUGIN_VERSION } from './build-info.js';
import { TRANSCODES_ROUTER_BODY } from './router-body.js';

const MCP_TOOL_LOOKUP_NAME_GUIDANCE =
  'MCP full wire name from the host PreToolUse hook (e.g. mcp__mongodb__list_collections). External mcp__* names are gated via POST /guard/evaluate; built-in transcodes-guard MCP skips the hook (handler backstop only).';

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

/** Drop local pending state when the backend session is terminal (rejected). */
function dismissPendingSession(backend: GateBackend, sid: string): void {
  const found = backend.findPendingBySid(sid);
  if (found) backend.clearPending(found.fp);
}

function textResult(text: string, isError = false) {
  return {
    isError,
    content: [{ type: 'text' as const, text }],
  };
}

function formatToolRulesMarkdown(rules: MergedToolRule[]): string {
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
      `| \`${r.id}\` | \`${r.name}\` | ${r.description} | ${r.action ?? '—'} | ${r.resource ?? '—'} |`,
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

  server.registerTool(
    'create_stepup_session',
    {
      title: 'Create Step-up MFA Session',
      description:
        'Open a Transcodes step-up MFA session. Returns sid and the browser URL ' +
        'the user must visit to complete WebAuthn. The same flow is used by the ' +
        'PreToolUse hook when a danger command is detected.',
      inputSchema: {
        comment: z
          .string()
          .min(1)
          .describe(
            'One short sentence shown on the step-up screen explaining the reason.',
          ),
        action: z
          .string()
          .optional()
          .describe('Action identifier for the audit log.'),
        resource: z
          .string()
          .optional()
          .describe('Protected resource identifier for the audit log.'),
        member_id: z
          .string()
          .optional()
          .describe(
            'Member public id to authenticate. Defaults to the mid claim in TRANSCODES_TOKEN.',
          ),
      },
    },
    async ({ comment, action, resource, member_id }) => {
      const result = await backend.createStepupSession({
        comment,
        action,
        resource,
        member_id,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: result.envelope.ok,
                status: result.envelope.status,
                sid: result.sid,
                browser_url: result.browserUrl,
                expires_at: result.expiresAt,
                raw: result.envelope.data,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'poll_stepup_session',
    {
      title: 'Poll Step-up MFA Session',
      description:
        "Single GET against the step-up backend. Returns status 'pending', " +
        "'verified', or 'rejected'. On verified the result is cached cross-platform " +
        'so a subsequent danger command in the hook can pass without re-prompting. ' +
        'On rejected the local pending record is cleared so Stop hooks stop reminding. ' +
        'Prefer `poll_stepup_session_wait` for the deny-recovery loop — it ' +
        'blocks until a terminal status in one call instead of requiring 60 manual ' +
        'iterations.',
      inputSchema: {
        sid: z
          .string()
          .min(1)
          .describe('Session id returned from create_stepup_session.'),
      },
    },
    async ({ sid }) => {
      const result = await backend.pollStepupSession(sid);
      if (result.status === 'verified') {
        // Route the verified record to the right store: the pending record
        // carries the fp for the hook-consume (Bash/user) path; absent fp
        // → GLOBAL store (MCP system path). Recomputing fp here is impossible
        // (we only have the sid), so the gate-time fp is read back via the
        // pending record it created.
        const fp = backend.findPendingBySid(sid)?.fp;
        backend.writeVerified({ sid, verifiedAt: Date.now() }, fp);
        backend.markVerified(sid);
      } else if (result.status === 'rejected') {
        dismissPendingSession(backend, sid);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: result.envelope.ok,
                status: result.envelope.status,
                step_status: result.status,
                raw: result.envelope.data,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'poll_stepup_session_wait',
    {
      title: 'Wait for Step-up MFA Session',
      description:
        'Block until the step-up session reaches `verified`, `rejected`, or the ' +
        'wait window elapses (default 60s, polling every 1s). Use this — NOT the ' +
        'single-shot `poll_stepup_session` — as the next action after a PreToolUse ' +
        'deny carrying a step-up sid. One call replaces the 60-iteration polling ' +
        'loop. On `outcome: "verified"` retry the original Bash command; on ' +
        '`outcome: "timeout"` ask the user to complete WebAuthn and call this ' +
        'tool again; on `outcome: "rejected"` tell the user they declined step-up ' +
        'and do NOT retry the command. Do NOT ask the user to confirm completion ' +
        "before calling this tool — it waits on the user's behalf.",
      inputSchema: {
        sid: z
          .string()
          .min(1)
          .describe('Session id returned from create_stepup_session.'),
        max_wait_ms: z
          .number()
          .int()
          .positive()
          .max(300_000)
          .optional()
          .describe('Maximum time to wait in ms. Defaults to 60_000.'),
        interval_ms: z
          .number()
          .int()
          .positive()
          .max(10_000)
          .optional()
          .describe('Polling interval in ms. Defaults to 1_000.'),
      },
    },
    async ({ sid, max_wait_ms, interval_ms }) => {
      const result = await backend.pollStepupSessionWait(sid, {
        maxWaitMs: max_wait_ms,
        intervalMs: interval_ms,
      });
      if (result.outcome === 'verified') {
        const fp = backend.findPendingBySid(sid)?.fp;
        backend.writeVerified({ sid, verifiedAt: Date.now() }, fp);
        backend.markVerified(sid);
      } else {
        // rejected OR timeout: drop the pending record so the Stop hook
        // stops re-emitting the "still PENDING" reminder every turn.
        dismissPendingSession(backend, sid);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: result.envelope.ok,
                outcome: result.outcome,
                attempts: result.attempts,
                elapsed_ms: result.elapsedMs,
                raw: result.envelope.data,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'inspect_stepup_state',
    {
      title: 'Inspect step-up state on disk',
      description:
        'Single source of truth for what the step-up state files look ' +
        'like RIGHT NOW. Returns structured JSON for verified / pending / ' +
        'browser-lock records with explicit `age_ms`, `expired`, and ' +
        '`ttl_ms` fields so the agent never has to compute expiry from ' +
        'raw timestamps or trust a wrapped `ls` output. Strict read-only: ' +
        'this tool never consumes or rewrites any record. Call this ' +
        'BEFORE and AFTER any step-up flow to verify state transitions ' +
        'deterministically.',
      inputSchema: {},
    },
    async () => {
      const snapshot = backend.inspectStepupState();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(snapshot, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'simulate_hook_invocation',
    {
      title: 'Invoke PreToolUse hook in a controlled subprocess',
      description:
        'Spawns the actual PreToolUse hook binary with a Bash payload as ' +
        'stdin, captures stdout/stderr/exit, and diffs the step-up state ' +
        'files before/after — all in one structured response. Use this ' +
        'when you need to verify hook behaviour (fast-path consumption, ' +
        'deny emission, new step-up start) without inferring from `exit ' +
        '127` or `ls` output. WARNING: this is NOT a dry run — the hook ' +
        'may consume the verified record or create a new step-up session ' +
        'and open a browser tab if a danger pattern is hit. Use it the ' +
        'way you would a real hook invocation, not as a side-effect-free ' +
        'probe.',
      inputSchema: {
        command: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Bash command string. Builds tool_input={command} when tool_name is Bash and tool_input is not provided. Ignored if tool_input is set.',
          ),
        cwd: z
          .string()
          .optional()
          .describe(
            'Optional working directory passed to the hook payload. Defaults to process.cwd().',
          ),
        tool_name: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Tool name to put in the PreToolUse payload. Defaults to 'Bash'. For MCP tool simulation use the wire name, e.g. 'mcp__plugin_transcodes-guard_transcodes-guard__retire_member'.",
          ),
        tool_input: z
          .unknown()
          .optional()
          .describe(
            'Raw tool_input object. Overrides the {command}-based default. Use for MCP tool simulation.',
          ),
      },
    },
    async ({ command, cwd, tool_name, tool_input }) => {
      const effectiveToolName = tool_name ?? 'Bash';
      const effectiveToolInput =
        tool_input !== undefined
          ? tool_input
          : command !== undefined
            ? { command }
            : {};
      if (
        effectiveToolName === 'Bash' &&
        !(effectiveToolInput as { command?: unknown })?.command
      ) {
        return textResult(
          'Rejected: Bash payload requires `command` (or `tool_input.command`).',
          true,
        );
      }
      const before = backend.inspectStepupState();
      // Host-supplied plugin install root. Claude Code sets
      // CLAUDE_PLUGIN_ROOT; Codex CLI sets PLUGIN_ROOT (+ honors
      // CLAUDE_PLUGIN_ROOT as alias). Fail loudly when neither is
      // present — silently resolving relative to the package's dist
      // would point at the wrong directory now that the server lives
      // in a workspace package rather than the plugin tree.
      const pluginRoot =
        process.env.CLAUDE_PLUGIN_ROOT?.trim() ||
        process.env.PLUGIN_ROOT?.trim();
      if (!pluginRoot) {
        return textResult(
          'Rejected: CLAUDE_PLUGIN_ROOT (or PLUGIN_ROOT for Codex) must be set so the hook binary can be located.',
          true,
        );
      }
      const hookPath = path.resolve(pluginRoot, 'dist/hooks/pre-tool-use.js');
      const payload = JSON.stringify({
        tool_name: effectiveToolName,
        tool_input: effectiveToolInput,
        cwd: cwd ?? process.cwd(),
      });
      const { stdout, stderr, exitCode } = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
      }>((resolve) => {
        const child = childSpawn('node', [hookPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
        child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
        child.on('close', (code) =>
          resolve({ stdout, stderr, exitCode: code ?? -1 }),
        );
        child.on('error', () => resolve({ stdout, stderr, exitCode: -1 }));
        child.stdin.end(payload);
      });
      const after = backend.inspectStepupState();
      let parsedStdout: unknown = null;
      try {
        parsedStdout = stdout.trim() ? JSON.parse(stdout) : null;
      } catch {
        // Hook exited without JSON — leave parsedStdout as null and let
        // the agent inspect raw stdout below.
      }
      const denyEmitted =
        parsedStdout !== null &&
        typeof parsedStdout === 'object' &&
        (parsedStdout as Record<string, unknown>).hookSpecificOutput !==
          undefined &&
        (
          (parsedStdout as Record<string, unknown>)
            .hookSpecificOutput as Record<string, unknown>
        ).permissionDecision === 'deny';
      const verifiedConsumed = before.verified.exists && !after.verified.exists;
      const pendingCleared = before.pending.exists && !after.pending.exists;
      const newPendingStarted =
        !before.pending.exists ||
        (before.pending.exists &&
          after.pending.exists &&
          before.pending.sid !== after.pending.sid)
          ? after.pending.exists
          : false;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                fast_path_taken: verifiedConsumed && !denyEmitted,
                deny_emitted: denyEmitted,
                new_step_up_started: newPendingStarted && denyEmitted,
                verified_consumed: verifiedConsumed,
                pending_cleared: pendingCleared,
                exit_code: exitCode,
                stdout_json: parsedStdout,
                stdout_raw: parsedStdout === null ? stdout : undefined,
                stderr: stderr || undefined,
                state_before: before,
                state_after: after,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Echoes the given message back to the caller.',
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: `Echo: ${message}` }],
    }),
  );

  server.registerTool(
    'simulate_command',
    {
      title: 'Simulate Bash hook gating (Guard v3)',
      description:
        'Read-only check whether a Bash command would be intercepted by the PreToolUse hook. Guard v3 routes ALL Bash commands through POST /guard/evaluate — there is no local regex layer. Does NOT invoke the hook, open a browser, or write disk state. Use `simulate_hook_invocation` for full-fidelity hook testing (including verified fast-path consumption).',
      inputSchema: { command: z.string().min(1) },
    },
    async ({ command }) => {
      if (!backend.hasToken()) {
        return textResult(
          JSON.stringify(
            {
              matched: true,
              will_trigger_hook: true,
              matched_by: 'block-no-token',
              command,
              note: 'No TRANSCODES_TOKEN configured — hook denies before POST /guard/evaluate.',
            },
            null,
            2,
          ),
        );
      }
      return textResult(
        JSON.stringify(
          {
            matched: true,
            will_trigger_hook: true,
            matched_by: 'guard-evaluate',
            command,
            note: 'All Bash commands reach POST /guard/evaluate. Outcome: permission 0=hard block, 1=allow, 2=step-up MFA. A valid verified record for this command may allow without re-prompting — use simulate_hook_invocation to test.',
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerPrompt(
    'greeting',
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

  backend.registerBackendTools(server);

  server.registerResource(
    'tool-rules',
    'tool-rules://list',
    {
      title: 'Step-up-protected MCP tool rules (system)',
      description:
        'Read-only list of system MCP tool-rules from hooks/tool-rules.json. These gate built-in transcodes-guard MCP tools via execProtectedTool — external mcp__* tools use POST /guard/evaluate instead.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: formatToolRulesMarkdown(loadMergedToolRules()),
        },
      ],
    }),
  );

  server.registerTool(
    'simulate_tool_call',
    {
      title: 'Simulate MCP hook gating',
      description:
        'Given a full MCP wire tool name from a PreToolUse hook, report whether the hook would gate it. External mcp__* wire names are gated via POST /guard/evaluate. Built-in transcodes-guard MCP (mcp__*transcodes-guard*) skips the hook — execProtectedTool handler backstop applies. Read-only — does not invoke the hook or call the backend.',
      inputSchema: {
        tool_name: z.string().min(1).describe(MCP_TOOL_LOOKUP_NAME_GUIDANCE),
        tool_input: z.unknown().optional(),
      },
    },
    async ({ tool_name }) => {
      if (isTranscodesGuardWireToolName(tool_name)) {
        return textResult(
          JSON.stringify(
            {
              tool_name,
              matched: false,
              will_trigger_hook: false,
              matched_by: 'transcodes-guard-handler',
              note: 'Built-in transcodes-guard MCP skips PreToolUse /guard/evaluate; execProtectedTool handler backstop applies.',
            },
            null,
            2,
          ),
        );
      }
      if (isMcpWireToolName(tool_name)) {
        return textResult(
          JSON.stringify(
            {
              tool_name,
              matched: true,
              will_trigger_hook: true,
              matched_by: 'guard-evaluate',
              note: 'External mcp__* wire names reach POST /guard/evaluate.',
            },
            null,
            2,
          ),
        );
      }

      return textResult(
        JSON.stringify(
          {
            tool_name,
            matched: false,
            will_trigger_hook: false,
            note: 'Non-MCP tool names are not gated by transcodes-guard at the PreToolUse hook.',
          },
          null,
          2,
        ),
      );
    },
  );

  return server;
}
