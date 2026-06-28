import { spawn as childSpawn } from 'node:child_process';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  currentHostProvider,
  findFirstMatch,
  type GuardProvider,
  type MergedPattern,
  ruleAppliesToHost,
} from '@transcodes-guard/danger-patterns';
import {
  type GateBackend,
  getGateBackend,
  type MergedToolRule,
  type ToolRule,
} from '@transcodes-guard/gate-contract';
import { z } from 'zod';
import { PLUGIN_VERSION } from './build-info.js';
import { TRANSCODES_ROUTER_BODY } from './router-body.js';

const RBAC_ACTION_GUIDANCE =
  "RBAC step-up coordinate. WORKFLOW: call `get_resources` first to fetch valid resource keys, then pass `stepupResource` (must match one of those keys; validated against the backend) and `stepupAction` (CRUD). System rules use resource `system`. This maps the rule onto the project's RBAC permission matrix and audit log.";

const TOOL_RULE_RBAC_GUIDANCE =
  'RBAC step-up coordinate. WORKFLOW: call `get_resources` first, then pass `resource` (must match a valid key) and `action` (create|read|update|delete). System rules use resource `system`.';

const MCP_TOOL_NAME_GUIDANCE =
  'MCP tool name as emitted by the host hook (PreToolUse, or Codex PermissionRequest for Apps connector calls). Call simulate_tool_call with the same string to verify before saving. Before saving, also confirm this MCP tool is actually connected to the host (see the add_tool_rule existence pre-check) — never register a rule for an MCP that is not available.';

const MCP_TOOL_LOOKUP_NAME_GUIDANCE =
  'MCP full wire name, or a canonical tool id/alias shown by tool-rules://list. Alias lookup is display-only and reports will_trigger_hook=false; use the full wire name to verify actual hook behavior.';

const MCP_EXISTENCE_PRECHECK =
  'MCP EXISTENCE PRE-CHECK (mandatory, do this FIRST): a rule must only be registered for an MCP tool that is actually connected to THIS host. Inspect your own available-tools list and confirm the target MCP server/tool is present — e.g. before adding a Google Calendar rule, verify a Google Calendar MCP tool (mcp__..._google_calendar__...) is actually available in this agent (this applies to every host: Claude Code / Codex / Cursor / Antigravity). If the MCP is NOT connected, you MUST REFUSE: do not call add_tool_rule, and tell the user the rule was rejected because the MCP is not connected to this host. Only proceed when the MCP is confirmed present.';

const ID_COLLISION_HINT =
  "Each host (claude/codex/cursor/antigravity) needs its OWN rule because the same tool has a different wire name per host. Pick a NEW provider-prefixed id (e.g. `claude-<slug>`, `codex-<slug>`). Provider is set automatically from this MCP server's host (TRANSCODES_GUARD_HOST always wins) — do NOT use update_tool_rule to repoint another host's rule.";

const TRANSCODES_GUARD_WIRE_PREFIX =
  'mcp__plugin_transcodes-guard_transcodes-guard__';

/** Host identity from `TRANSCODES_GUARD_HOST` (set by each plugin's host.ts). */
function lockedHostProvider():
  | { ok: true; provider: GuardProvider }
  | { ok: false; message: string } {
  const provider = currentHostProvider();
  if (provider === undefined) {
    return {
      ok: false,
      message:
        'Rejected: this MCP server has no host identity (TRANSCODES_GUARD_HOST). Cannot save a host-scoped tool rule.',
    };
  }
  return { ok: true, provider };
}

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

function formatPatternsMarkdown(patterns: MergedPattern[]): string {
  const lines: string[] = [
    '# Blocked Bash command patterns',
    '',
    `${patterns.length} pattern(s) intercept Bash invocations before execution.`,
    'System patterns are immutable. Project bash patterns are stored in the Transcodes backend (policy bundle); register via `add_user_pattern` / edit via `update_user_pattern`. Patterns are created inactive and can only be activated or deleted in the Next.js console.',
    '',
    '| source | id | reason | regex |',
    '| ------ | -- | ------ | ----- |',
  ];
  for (const { source, id, reason, regex } of patterns) {
    lines.push(`| ${source} | \`${id}\` | ${reason} | \`${regex}\` |`);
  }
  return lines.join('\n');
}

/** Drop local pending state when the backend session is terminal (rejected). */
function dismissPendingSession(backend: GateBackend, sid: string): void {
  const found = backend.findPendingBySid(sid);
  if (found) backend.clearPending(found.fp);
}

function formatToolRulesMarkdown(rules: MergedToolRule[]): string {
  const lines: string[] = [
    '# Step-up-protected MCP tool rules',
    '',
    `${rules.length} rule(s) gate MCP tool invocations via the PreToolUse hook.`,
    'Project rules are stored in the Transcodes backend; register via `add_tool_rule` / edit via `update_tool_rule`. Rules are created inactive and can only be activated or deleted in the Next.js console. System rules are immutable.',
    '',
    '| source | rule id | canonical tool id | display name | aliases | wire name / pattern | description | action | resource | matcher |',
    '| ------ | ------- | ----------------- | ------------ | ------- | ------------------- | ----------- | ------ | -------- | ------- |',
  ];
  for (const r of rules) {
    const metadata = describeToolRuleName(r);
    lines.push(
      `| ${r.source} | \`${r.id}\` | ${formatCanonicalToolId(
        metadata,
      )} | ${metadata.display_name} | ${formatAliases(
        metadata,
      )} | \`${r.name}\` | ${r.description} | ${r.action ?? '—'} | ${
        r.resource ?? '—'
      } | ${r.matcher} |`,
    );
  }
  return lines.join('\n');
}

function describeToolRuleName(rule: MergedToolRule) {
  const isExactMcp = rule.type === 'mcp' && rule.matcher === 'exact';
  const canonical = isExactMcp
    ? rule.name.startsWith(TRANSCODES_GUARD_WIRE_PREFIX)
      ? rule.name.slice(TRANSCODES_GUARD_WIRE_PREFIX.length)
      : rule.name
    : undefined;
  const aliases = new Set<string>();
  if (canonical && canonical !== rule.name) aliases.add(rule.name);
  return {
    canonical_tool_id: canonical,
    display_name: rule.label || canonical || rule.name,
    aliases: [...aliases],
  };
}

function findToolRulesByAlias(
  toolName: string,
  rules: MergedToolRule[],
): MergedToolRule[] {
  const target = toolName.toLowerCase();
  return rules.filter((rule) => {
    if (rule.type !== 'mcp' || rule.matcher !== 'exact') return false;
    // 실제 게이트(resolveProtectedToolRule)와 동일하게 host-scoping을 적용해,
    // 다른 호스트 전용 룰을 이 호스트에서 "적용됨"으로 오보하지 않는다.
    if (!ruleAppliesToHost(rule)) return false;
    const metadata = describeToolRuleName(rule);
    return [
      ...(metadata.canonical_tool_id ? [metadata.canonical_tool_id] : []),
      ...metadata.aliases,
    ].some((name) => name.toLowerCase() === target);
  });
}

function toolRuleSummary(rule: MergedToolRule) {
  const metadata = describeToolRuleName(rule);
  return {
    id: rule.id,
    canonical_tool_id: metadata.canonical_tool_id,
    display_name: metadata.display_name,
    aliases: metadata.aliases,
    source: rule.source,
    type: rule.type,
    label: rule.label,
    description: rule.description,
    name: rule.name,
    matcher: rule.matcher,
    provider: rule.provider,
    action: rule.action,
    resource: rule.resource,
  };
}

function looksLikeCodexAppsToolName(toolName: string): boolean {
  return (
    toolName.startsWith('codex_apps.') ||
    toolName.startsWith('mcp__codex_apps__') ||
    /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(toolName)
  );
}

function formatCanonicalToolId(
  metadata: ReturnType<typeof describeToolRuleName>,
) {
  return metadata.canonical_tool_id ? `\`${metadata.canonical_tool_id}\`` : '—';
}

function formatAliases(metadata: ReturnType<typeof describeToolRuleName>) {
  return metadata.aliases.length
    ? metadata.aliases.map((alias) => `\`${alias}\``).join(', ')
    : '—';
}

function textResult(text: string, isError = false) {
  return {
    isError,
    content: [{ type: 'text' as const, text }],
  };
}

export function createServer(
  backend: GateBackend = getGateBackend(),
): McpServer {
  const server = new McpServer({
    name: 'transcodes-guard-mcp',
    version: PLUGIN_VERSION,
  });

  // Boot-time policy bundle refresh (Phase3 v2 G2) — fire-and-forget so
  // transport connect is never delayed; failures keep the cached bundle and
  // an unconfigured machine skips silently.
  void backend.refreshPolicyBundle();

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

  server.registerResource(
    'danger-patterns',
    'danger-patterns://list',
    {
      title: 'Blocked Bash patterns',
      description:
        'Regex patterns the PreToolUse hook uses to block dangerous Bash commands. Merges immutable system patterns with project bash rules from the signed policy bundle (Transcodes backend).',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: formatPatternsMarkdown(backend.loadEffectivePatterns()),
        },
      ],
    }),
  );

  server.registerTool(
    'simulate_command',
    {
      title: 'Simulate command against block patterns',
      description:
        "Check whether a specific Bash command would be blocked by the PreToolUse hook's regex layer. Call this whenever the user mentions a concrete command and asks if it is dangerous, safe, blocked, intercepted, allowed, or whether the hook/danger-patterns would catch it — including Korean phrasings like '이 명령 차단될까', '이거 hook에 걸려?', 'rm -rf src 실행해도 돼?', '미리 검사해줘'. ALSO use this as the mandatory verification step (step 2) of the `add_user_pattern` natural-language → regex workflow: before saving a regex you inferred from a plain-language intent, simulate a should-match example and a should-NOT-match example to catch false positives. Runs against the union of system and user patterns. Does NOT simulate the second-layer `rm -rf` git-tracked check (cwd-dependent), so the hook may still block commands this tool reports as allowed.",
      inputSchema: { command: z.string().min(1) },
    },
    async ({ command }) => {
      const patterns = backend.loadEffectivePatterns();
      const hit = findFirstMatch(command, patterns);
      if (!hit) {
        return textResult(
          JSON.stringify(
            {
              matched: false,
              will_trigger_hook: false,
              patterns_checked: patterns.length,
              note: 'Hook may still block via the rm -rf git-tracked semantic check; simulator does not cover that layer.',
            },
            null,
            2,
          ),
        );
      }
      const m = hit.matched;
      return textResult(
        JSON.stringify(
          {
            matched: true,
            matched_by: m.source,
            pattern_id: m.id,
            reason: m.reason,
            regex: m.regex,
            will_trigger_hook: true,
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    'add_user_pattern',
    {
      title: 'Add user danger pattern',
      description:
        'Register a new project bash block pattern (type bash, regex stored in `name`) that the PreToolUse hook enforces. Persisted to the Transcodes backend policy bundle — not a local file. Call when the user asks to add/register/block a Bash command pattern.\n\nDISAMIGUATION — pick by what is being matched: Bash COMMAND STRING → this tool; MCP TOOL CALL → `add_tool_rule`.\n\nWhen adding an MCP tool rule and the same action can be reached via CLI (e.g. `gh`, `git`, `curl`), also register the CLI equivalent here as a separate rule (same id prefix with `-cli` suffix is fine).\n\nWORKFLOW: translate intent → `simulate_command` → confirm with user → `get_resources` for RBAC → save.',
      inputSchema: {
        id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase alphanumeric + hyphen'),
        regex: z.string().min(1),
        reason: z.string().min(1),
        stepupResource: z.string().min(1).describe(RBAC_ACTION_GUIDANCE),
        stepupAction: z
          .enum(['create', 'read', 'update', 'delete'])
          .describe('RBAC CRUD action this pattern maps onto.'),
      },
    },
    async (input) => {
      try {
        await backend.assertRbacCoordinate(
          input.stepupResource,
          input.stepupAction,
        );
        const saved = await backend.addToolRule({
          id: input.id,
          type: 'bash',
          label: input.reason,
          description: input.reason,
          name: input.regex,
          matcher: 'regex',
          resource: input.stepupResource,
          action: input.stepupAction,
        });
        return textResult(
          `Added bash pattern \`${saved.id}\` to project policy.\nregex: ${
            saved.name
          }\nreason: ${saved.description}\nresource: ${
            saved.resource ?? '—'
          }\naction: ${saved.action ?? '—'}`,
        );
      } catch (e) {
        if (
          backend.isToolRuleValidationError(e) ||
          backend.isRbacCoordinateError(e)
        ) {
          return textResult(`Rejected: ${e.message}`, true);
        }
        throw e;
      }
    },
  );

  server.registerTool(
    'update_user_pattern',
    {
      title: 'Update user danger pattern',
      description:
        'Modify a project bash pattern (Transcodes backend). System patterns cannot be modified.',
      inputSchema: {
        id: z.string().min(1),
        regex: z.string().min(1).optional(),
        reason: z.string().min(1).optional(),
        stepupResource: z
          .string()
          .min(1)
          .optional()
          .describe(RBAC_ACTION_GUIDANCE),
        stepupAction: z
          .enum(['create', 'read', 'update', 'delete'])
          .optional()
          .describe('RBAC CRUD action this pattern maps onto.'),
      },
    },
    async ({ id, regex, reason, stepupResource, stepupAction }) => {
      if (
        regex === undefined &&
        reason === undefined &&
        stepupResource === undefined &&
        stepupAction === undefined
      ) {
        return textResult(
          'Rejected: provide at least one of `regex`, `reason`, `stepupResource`, or `stepupAction` to update.',
          true,
        );
      }
      try {
        if (
          !backend
            .loadEffectivePatterns()
            .some((p) => p.id === id && p.source === 'bundle')
        ) {
          return textResult(
            `Rejected: no project bash pattern with id "${id}"`,
            true,
          );
        }
        if (stepupResource !== undefined) {
          await backend.assertRbacCoordinate(
            stepupResource,
            stepupAction ?? 'update',
          );
        }
        const saved = await backend.updateToolRule(id, {
          type: 'bash',
          ...(regex !== undefined ? { name: regex, matcher: 'regex' } : {}),
          ...(reason !== undefined
            ? { label: reason, description: reason }
            : {}),
          ...(stepupResource !== undefined ? { resource: stepupResource } : {}),
          ...(stepupAction !== undefined ? { action: stepupAction } : {}),
        });
        return textResult(
          `Updated bash pattern \`${saved.id}\`.\nregex: ${
            saved.name
          }\nreason: ${saved.description}\nresource: ${
            saved.resource ?? '—'
          }\naction: ${saved.action ?? '—'}`,
        );
      } catch (e) {
        if (
          backend.isToolRuleValidationError(e) ||
          backend.isRbacCoordinateError(e)
        ) {
          return textResult(`Rejected: ${e.message}`, true);
        }
        throw e;
      }
    },
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
        'Open the transcodes-guard control surface. Say what you want in plain language (add a rule, list rules, check a command, step-up status, integrate/install the SDK) and the agent routes to the right guard tool, asking for any missing detail.',
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
      title: 'Step-up-protected MCP tool rules',
      description:
        'Tool-name rules that the PreToolUse hook uses to enforce step-up MFA on MCP tool calls. Merges immutable system rules (hooks/tool-rules.json) with the project policy bundle distributed from the Transcodes backend, read fresh at every request.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: formatToolRulesMarkdown(backend.loadMergedToolRules()),
        },
      ],
    }),
  );

  server.registerTool(
    'refresh_rules',
    {
      title: 'Refresh rules from the Transcodes backend',
      description:
        'Force-refresh the org policy bundle cache NOW and return the currently active tool rules. Call when an admin just activated/deactivated or edited a rule in the Next.js console and the change is not yet visible in this session — the MCP server otherwise only refreshes at boot / TTL, so a console change can take up to the TTL to apply. Same force-refresh the CLI `transcodes policy refresh` performs. Read-only beyond the cache fetch.',
      inputSchema: {},
    },
    async () => {
      const outcome = await backend.refreshPolicyBundle();
      const status: Record<string, string> = {
        fresh: 'Refreshed — cache now holds the latest bundle.',
        refreshed: 'Refreshed — cache updated to the latest bundle.',
        'not-modified': 'Already current — backend confirmed no changes.',
        failed:
          'Refresh FAILED — kept the previous cache (last-known-good). Rules below may be stale.',
        skipped:
          'Skipped — no Transcodes token configured, so there is nothing to refresh.',
      };
      const header = `# Policy bundle refresh\n\n${
        status[outcome] ?? `Outcome: ${outcome}`
      }`;
      const rules = formatToolRulesMarkdown(backend.loadMergedToolRules());
      return textResult(`${header}\n\n${rules}`, outcome === 'failed');
    },
  );

  server.registerTool(
    'add_tool_rule',
    {
      title: 'Add MCP tool-rule (project policy)',
      description: `Register a new project tool-rule that the PreToolUse hook enforces (deny + step-up + retry) when a matching MCP tool is called. Call when the user asks to add/register/block a rule for an MCP tool, or to require step-up auth before a specific tool runs — e.g. "add a tool rule for the github delete repo tool", "require auth when the notion delete page tool is called".\n\nDISAMBIGUATION — this gate has two registries; pick by what is being matched:\n  - A free-form Bash COMMAND STRING (sudo, rm -rf, git push) → use \`add_user_pattern\` (regex matching), NOT this tool.\n  - A specific MCP TOOL CALL → use this tool (\`name\` must match the hook's full wire tool name).\nIf the user just says "add a rule" without specifying, ask whether they mean a Bash command pattern or an MCP tool before calling either tool.\n\nWORKFLOW (follow in order):\n  1. ${MCP_EXISTENCE_PRECHECK}\n  2. RESOLVE the exact wire tool name from the host (e.g. mcp__github__delete_repository, mcp__plugin_<plugin>_<server>__<tool>). Do not guess — confirm with the user or read it from the host's available tools list.\n  3. VERIFY with \`simulate_tool_call\` using that full \`name\` string before saving.\n  4. RESOLVE the RBAC coordinate: call \`get_resources\`, then set \`resource\` and \`action\` (create|read|update|delete). Most rules use resource \`system\`.\n  5. CONFIRM id, name, label, description, resource, action, and matcher with the user, then SAVE via this tool.\n  6. If the same action can be reached via CLI (gh, git, curl, etc.), pass \`cliRegex\` so a Bash companion rule (\`<id>-cli\`) is registered ATOMICALLY in the same call — closing the CLI bypass without a second tool call. The companion reuses this rule's label/description/resource/action. (Standalone Bash patterns unrelated to an MCP tool still go through \`add_user_pattern\`.)\n\`id\` is your stable rule key (lowercase slug, unique per project). \`name\` is what the hook matches — always the full MCP wire name when matcher=exact. Persisted in the Transcodes backend; effective on the next policy refresh.\n\nPER-HOST RULES: each host (claude/codex/cursor/antigravity) exposes the SAME logical tool under a DIFFERENT wire name, so protecting a tool everywhere needs ONE rule PER host. PREFIX \`id\` with the host slug (e.g. \`codex-mongodb-list-collections\`, \`antigravity-mongodb-list-collections\`); provider is set automatically from this MCP server's host (TRANSCODES_GUARD_HOST always wins). A rule WITH \`provider\` only fires on that host; a rule WITHOUT \`provider\` fires on every host (used by the built-in baseline). To add coverage for another host, ADD a new provider-prefixed rule from that host — never \`update_tool_rule\` an existing host's rule onto a different host.`,
      inputSchema: {
        id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase alphanumeric + hyphen'),
        type: z.literal('mcp').default('mcp'),
        label: z.string().min(1),
        description: z.string().min(1),
        name: z.string().min(1).describe(MCP_TOOL_NAME_GUIDANCE),
        matcher: z
          .enum(['exact', 'glob'])
          .default('exact')
          .describe(
            'exact = full wire name equality; glob = * and ? wildcards in name',
          ),
        provider: z
          .enum(['claude', 'codex', 'cursor', 'antigravity'])
          .optional()
          .describe(
            "Host this rule is for (claude/codex/cursor/antigravity). Normally IGNORED — the server uses this MCP server's host (TRANSCODES_GUARD_HOST), which always takes priority. It is only honored as a fallback when the server has no host identity. Prefix `id` with the host slug (e.g. `claude-mongodb-list-collections`).",
          ),
        resource: z.string().min(1).describe(TOOL_RULE_RBAC_GUIDANCE),
        action: z
          .enum(['create', 'read', 'update', 'delete'])
          .describe('RBAC CRUD action this tool maps onto.'),
        status: z.enum(['active', 'inactive']).default('active'),
        cliRegex: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional CLI companion. When the same action is reachable via a shell command (gh, git, curl, …), pass a JavaScript regex here and a second Bash rule (id `<id>-cli`, type bash, matcher regex) is created atomically alongside the MCP rule, reusing this rule's label/description/resource/action. If either write fails the pair is rolled back so nothing partial is saved.",
          ),
      },
    },
    async (input) => {
      const { cliRegex, provider: inputProvider, ...rest } = input;
      // env (TRANSCODES_GUARD_HOST) ALWAYS wins: the rule's provider is the
      // host identity of the MCP server that actually runs the hook. An
      // agent-supplied `provider` is only a fallback for when this server has
      // no host identity (e.g. the standalone `mcp` host).
      const host = lockedHostProvider();
      const provider = host.ok ? host.provider : inputProvider;
      if (provider === undefined) {
        return textResult(
          'Rejected: this MCP server has no host identity (TRANSCODES_GUARD_HOST) and no `provider` was supplied. Pass `provider` (claude/codex/cursor/antigravity) explicitly.',
          true,
        );
      }
      const mcpInput = { ...rest, provider };
      // Pre-validate the companion regex before any write so a typo never
      // creates the MCP rule and then forces a rollback.
      if (cliRegex !== undefined) {
        try {
          new RegExp(cliRegex);
        } catch (e) {
          return textResult(
            `Rejected: cliRegex is not a valid JavaScript regex: ${
              (e as Error).message
            }`,
            true,
          );
        }
      }
      // Pre-check id collision against the rules we can already see (system +
      // cached bundle) so the agent gets provider-prefix guidance instead of a
      // bare 409 — and is never tempted to "fix" it by overwriting via update.
      const existingIds = new Set(
        backend.loadMergedToolRules().map((r) => r.id),
      );
      if (existingIds.has(mcpInput.id)) {
        return textResult(
          `Rejected: a tool-rule with id \`${mcpInput.id}\` already exists. ${ID_COLLISION_HINT}`,
          true,
        );
      }
      try {
        if (mcpInput.resource !== undefined) {
          await backend.assertRbacCoordinate(
            mcpInput.resource,
            mcpInput.action ?? 'update',
          );
        }
        const saved = await backend.addToolRule(mcpInput);

        let companion: ToolRule | undefined;
        if (cliRegex !== undefined) {
          const companionId = `${saved.id}-cli`;
          try {
            companion = await backend.addToolRule({
              id: companionId,
              type: 'bash',
              label: saved.label,
              description: saved.description,
              name: cliRegex,
              matcher: 'regex',
              ...(saved.resource !== undefined
                ? { resource: saved.resource }
                : {}),
              ...(saved.action !== undefined ? { action: saved.action } : {}),
            });
          } catch (companionErr) {
            // Compensating rollback: the backend has no batch endpoint, so to
            // keep the pair all-or-nothing we delete the MCP rule we just
            // created when the companion write fails.
            let rolledBack = true;
            try {
              await backend.removeToolRule(saved.id);
            } catch {
              rolledBack = false;
            }
            if (
              backend.isToolRuleValidationError(companionErr) ||
              backend.isRbacCoordinateError(companionErr)
            ) {
              return textResult(
                `Rejected: CLI companion rule \`${companionId}\` failed — ${
                  companionErr.message
                }. ${
                  rolledBack
                    ? `Rolled back the MCP rule \`${saved.id}\`; nothing was saved.`
                    : `WARNING: could not roll back the MCP rule \`${saved.id}\` — it may still exist (inactive). Delete it from the Next.js console if unintended.`
                }`,
                true,
              );
            }
            throw companionErr;
          }
        }

        const mcpLine = `Added tool-rule \`${
          saved.id
        }\` to project policy.\nname: ${saved.name}\nlabel: ${
          saved.label
        }\ndescription: ${saved.description}\nresource: ${
          saved.resource ?? '—'
        }\naction: ${saved.action ?? '—'}\nmatcher: ${saved.matcher}${
          saved.provider ? `\nprovider: ${saved.provider}` : ''
        }`;
        if (companion) {
          return textResult(
            `${mcpLine}\n\nAlso registered CLI companion bash rule \`${
              companion.id
            }\` (atomic):\nregex: ${companion.name}\nresource: ${
              companion.resource ?? '—'
            }\naction: ${companion.action ?? '—'}`,
          );
        }
        return textResult(mcpLine);
      } catch (e) {
        if (
          backend.isToolRuleValidationError(e) ||
          backend.isRbacCoordinateError(e)
        ) {
          // Backend 409 backstop (another session created the id since our
          // local pre-check): append the same provider-prefix guidance so the
          // agent never falls back to overwriting via update_tool_rule.
          const hint = /already exists/i.test(e.message)
            ? ` ${ID_COLLISION_HINT}`
            : '';
          return textResult(`Rejected: ${e.message}.${hint}`, true);
        }
        throw e;
      }
    },
  );

  server.registerTool(
    'update_tool_rule',
    {
      title: 'Update MCP tool-rule (project policy)',
      description:
        'Modify fields of an existing project tool-rule by id. Call when the user asks to edit/change an MCP tool-rule — e.g. "change the description of the github-delete rule", "point that tool rule at a different MCP wire name". This is for MCP tool-rules (`name` = full wire tool name); to edit a Bash command pattern (regex) use `update_user_pattern` instead. System rules cannot be modified. Pass only the fields you want to change. When changing resource, call `get_resources` first. Changes persist to the Transcodes backend and take effect on the next policy refresh.',
      inputSchema: {
        id: z.string().min(1),
        type: z.literal('mcp').optional(),
        label: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        name: z.string().min(1).optional().describe(MCP_TOOL_NAME_GUIDANCE),
        matcher: z
          .enum(['exact', 'glob'])
          .optional()
          .describe('exact = full wire name; glob = wildcards in name'),
        provider: z
          .enum(['claude', 'codex', 'cursor', 'antigravity'])
          .optional()
          .describe(
            "Host this rule applies to (claude/codex/cursor/antigravity). Normally IGNORED — env (TRANSCODES_GUARD_HOST) always wins, so the rule is (re)pointed to this MCP server's host. Honored only as a fallback when the server has no host identity.",
          ),
        resource: z
          .string()
          .min(1)
          .optional()
          .describe(TOOL_RULE_RBAC_GUIDANCE),
        action: z
          .enum(['create', 'read', 'update', 'delete'])
          .optional()
          .describe('RBAC CRUD action this tool maps onto.'),
        status: z.enum(['active', 'inactive']).optional(),
      },
    },
    async ({
      id,
      type,
      label,
      description,
      name,
      matcher,
      provider,
      action,
      resource,
      status,
    }) => {
      const host = lockedHostProvider();

      if (
        type === undefined &&
        label === undefined &&
        description === undefined &&
        name === undefined &&
        matcher === undefined &&
        provider === undefined &&
        action === undefined &&
        resource === undefined &&
        status === undefined
      ) {
        return textResult(
          'Rejected: provide at least one of `type`, `label`, `description`, `name`, `matcher`, `provider`, `action`, `resource`, or `status` to update.',
          true,
        );
      }
      try {
        if (resource !== undefined) {
          await backend.assertRbacCoordinate(resource, action ?? 'update');
        }
        const saved = await backend.updateToolRule(id, {
          type,
          label,
          description,
          name,
          matcher,
          action,
          resource,
          status,
          // env (TRANSCODES_GUARD_HOST) ALWAYS wins: when this MCP server has a
          // host identity, the rule is (re)pointed to it. The agent-supplied
          // `provider` is only a fallback when there is no host identity.
          ...(host.ok
            ? { provider: host.provider }
            : provider !== undefined
              ? { provider }
              : {}),
        });
        return textResult(
          `Updated tool-rule \`${saved.id}\` in project policy.\nname: ${
            saved.name
          }\nlabel: ${saved.label}\ndescription: ${
            saved.description
          }\nresource: ${saved.resource ?? '—'}\naction: ${
            saved.action ?? '—'
          }\nmatcher: ${saved.matcher}${
            saved.provider ? `\nprovider: ${saved.provider}` : ''
          }`,
        );
      } catch (e) {
        if (
          backend.isToolRuleValidationError(e) ||
          backend.isRbacCoordinateError(e)
        ) {
          return textResult(`Rejected: ${e.message}`, true);
        }
        throw e;
      }
    },
  );

  server.registerTool(
    'simulate_tool_call',
    {
      title: 'Simulate a tool-rule lookup',
      description:
        'Given a full MCP wire tool name from a host hook (e.g. mcp__github__delete_repository, or a Codex Apps PermissionRequest dotted name) or a listed canonical tool id/alias, report whether any system or project tool-rule matches. Read-only — does not invoke the hook or call the backend. Use to verify a rule name before calling add_tool_rule.',
      inputSchema: {
        tool_name: z.string().min(1).describe(MCP_TOOL_LOOKUP_NAME_GUIDANCE),
        tool_input: z.unknown().optional(),
      },
    },
    async ({ tool_name }) => {
      const rules = backend.loadMergedToolRules();
      const directMatch = backend.findFirstToolRule(tool_name, rules);
      if (directMatch) {
        const codexAppsTool = looksLikeCodexAppsToolName(tool_name);
        return textResult(
          JSON.stringify(
            {
              tool_name,
              matched: true,
              will_trigger_hook: true,
              ...(codexAppsTool
                ? {
                    enforcement_note:
                      'Codex Apps connector calls may arrive via PermissionRequest instead of PreToolUse; the Codex plugin registers both for Apps-like tool names. End-to-end hook deny remains the final enforcement check.',
                  }
                : {}),
              matched_by: 'wire_name_or_pattern',
              rule: toolRuleSummary(directMatch.matched),
            },
            null,
            2,
          ),
        );
      }

      const aliasMatches = findToolRulesByAlias(tool_name, rules);
      if (aliasMatches.length === 0) {
        return textResult(
          JSON.stringify(
            {
              tool_name,
              matched: false,
              will_trigger_hook: false,
              rule_count: rules.length,
            },
            null,
            2,
          ),
        );
      }
      if (aliasMatches.length > 1) {
        return textResult(
          JSON.stringify(
            {
              tool_name,
              matched: false,
              will_trigger_hook: false,
              alias_ambiguous: true,
              candidates: aliasMatches.map(toolRuleSummary),
              note: 'Alias matched multiple tool-rules. Use the full wire name / pattern to simulate hook behavior.',
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
            alias_resolved: true,
            resolved_rule: toolRuleSummary(aliasMatches[0]),
            note: 'Alias resolution is display-only. Use resolved_rule.name as the full wire name / pattern to simulate hook behavior.',
          },
          null,
          2,
        ),
      );
    },
  );

  return server;
}
