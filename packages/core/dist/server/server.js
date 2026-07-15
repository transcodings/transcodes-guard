import { spawn as childSpawn } from 'node:child_process';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PLUGIN_VERSION } from '../build-info.js';
import { formatPollStepupSessionWaitAgentContext, getGateBackend, } from '../contract/index.js';
import { isGuardToolName, isMcpWireToolName, loadMergedToolRules, } from '../patterns/index.js';
import { TRANSCODES_ROUTER_BODY } from './router-body.js';
const MCP_TOOL_LOOKUP_NAME_GUIDANCE = 'MCP full wire name from the host PreToolUse hook (e.g. mcp__mongodb__list_collections). External mcp__* names are gated via POST /guard/evaluate; built-in transcodes-guard MCP skips the hook (handler backstop only).';
// The `/transcodes` umbrella command body lives in the generated
// router-body.ts (single source: scripts/router-body.mjs), which also renders
// the four per-host command/skill markdown files — no hand-mirroring.
function transcodesRouterBody(request) {
    const trimmed = request?.trim();
    return TRANSCODES_ROUTER_BODY.replace('{{REQUEST}}', trimmed && trimmed.length > 0
        ? trimmed
        : '(no request given — show the menu and ask what they want)');
}
function textResult(text, isError = false) {
    return {
        isError,
        content: [{ type: 'text', text }],
    };
}
function formatToolRulesMarkdown(rules) {
    const lines = [
        '# Step-up-protected MCP tool rules (system)',
        '',
        `${rules.length} system rule(s) gate built-in transcodes-guard MCP tools via the execProtectedTool handler backstop.`,
        'External mcp__* tools are gated via POST /guard/evaluate in the PreToolUse hook — not listed here.',
        '',
        '| id | tool name / pattern | description | action | resource |',
        '| -- | ------------------- | ----------- | ------ | -------- |',
    ];
    for (const r of rules) {
        lines.push(`| \`${r.id}\` | \`${r.name}\` | ${r.description} | ${r.action ?? '—'} | ${r.resource ?? '—'} |`);
    }
    return lines.join('\n');
}
export function createServer(backend = getGateBackend()) {
    const server = new McpServer({
        name: 'transcodes-guard-mcp',
        version: PLUGIN_VERSION,
    });
    server.registerResource('version-info', 'version://info', {
        title: 'Plugin version',
        description: 'Returns the running plugin version. Use this to confirm which build is currently loaded after an update.',
        mimeType: 'application/json',
    }, async (uri) => ({
        contents: [
            {
                uri: uri.href,
                mimeType: 'application/json',
                text: JSON.stringify({ version: PLUGIN_VERSION }, null, 2),
            },
        ],
    }));
    // ── /transcodes — single umbrella command (MCP prompt) ───────────────────
    // One "front door" the user opens with free-form text; the agent routes the
    // request to the right guard workflow and asks for any missing detail before
    // acting. It adds no capability — only a deterministic entrypoint that stops
    // the agent from mis-routing a natural-language request. The exact same
    // router body is mirrored in each plugin's native command/skill file for
    // hosts that don't surface MCP prompts as slash commands (Cursor/Codex/
    // Antigravity); keep them in sync (see TRANSCODES_ROUTER_BODY consumers).
    server.registerPrompt('transcodes', {
        title: 'transcodes-guard',
        description: 'Open the transcodes-guard control surface. Say what you want in plain language (check whether a Bash/MCP call would trigger step-up, inspect step-up state, Transcodes Admin API operations, integrate/install the SDK) and the agent routes to the right guard tool, asking for any missing detail.',
        argsSchema: { request: z.string().optional() },
    }, ({ request }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: transcodesRouterBody(request),
                },
            },
        ],
    }));
    server.registerTool('tc_create_stepup_session', {
        title: 'Create Step-up MFA Session',
        description: 'Open a Transcodes step-up MFA session. Returns sid and the browser URL ' +
            'the user must visit to complete WebAuthn. The same flow is used by the ' +
            'PreToolUse hook when a danger command is detected.',
        inputSchema: {
            summary: z
                .string()
                .min(1)
                .max(140)
                .describe('One sentence describing what the user is confirming on the step-up screen.'),
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
                .describe('Member public id to authenticate. Defaults to the mid claim in TRANSCODES_TOKEN.'),
        },
    }, async ({ summary, action, resource, member_id }) => {
        const result = await backend.createStepupSession({
            summary,
            action,
            resource,
            member_id,
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: result.envelope.ok,
                        status: result.envelope.status,
                        sid: result.sid,
                        browser_url: result.browserUrl,
                        expires_at: result.expiresAt,
                        raw: result.envelope.data,
                    }, null, 2),
                },
            ],
        };
    });
    server.registerTool('tc_poll_stepup_session', {
        title: 'Poll Step-up MFA Session',
        description: "Single GET against the step-up backend. Returns status 'pending', " +
            "'verified', or 'rejected'. Prefer resource+action (coordinate poll); " +
            'sid remains supported. Prefer `tc_poll_stepup_session_wait` for the ' +
            'deny-recovery loop.',
        inputSchema: {
            sid: z
                .string()
                .min(1)
                .optional()
                .describe('Optional tc_stepup_… from the deny payload.'),
            resource: z
                .string()
                .min(1)
                .optional()
                .describe('RBAC resource from the deny payload.'),
            action: z
                .string()
                .min(1)
                .optional()
                .describe('RBAC action from the deny payload.'),
        },
    }, async ({ sid, resource, action }) => {
        const trimmedSid = sid?.trim();
        const trimmedResource = resource?.trim();
        const trimmedAction = action?.trim();
        if (!trimmedSid && !(trimmedResource && trimmedAction)) {
            throw new Error('Provide sid, or both resource and action.');
        }
        const result = trimmedSid
            ? await backend.pollStepupSession(trimmedSid)
            : await backend.pollStepupByCoordinate({
                resource: trimmedResource,
                action: trimmedAction,
            });
        const resolvedSid = trimmedSid ??
            ('sid' in result && typeof result.sid === 'string'
                ? result.sid
                : undefined);
        if (result.status === 'verified' && typeof resolvedSid === 'string') {
            backend.markStepupVerified(resolvedSid);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: result.envelope.ok,
                        status: result.envelope.status,
                        step_status: result.status,
                        sid: resolvedSid,
                        raw: result.envelope.data,
                    }, null, 2),
                },
            ],
        };
    });
    server.registerTool('tc_poll_stepup_session_wait', {
        title: 'Wait for Step-up MFA Session',
        description: 'Block until the step-up session reaches `verified`, `rejected`, `not_found`, or ' +
            'the wait window elapses ' +
            '(default wait ~5 min, matching Redis TTL; poll every 1s). Prefer resource+action from the ' +
            'PreToolUse deny payload (coordinate poll). Optional sid still works. On verified retry ' +
            'the original command; on timeout, rejected, or not_found tell the user this command ' +
            'did not run, skip it, and continue other work. Do NOT re-poll or retry the SAME command ' +
            'unless the user explicitly asks to authenticate again. ' +
            'If the user says stop/cancel/skip at any time, abort this command and continue other work.',
        inputSchema: {
            sid: z
                .string()
                .min(1)
                .optional()
                .describe('Optional tc_stepup_… from the deny payload.'),
            resource: z
                .string()
                .min(1)
                .optional()
                .describe('RBAC resource from the deny payload (preferred).'),
            action: z
                .string()
                .min(1)
                .optional()
                .describe('RBAC action from the deny payload (preferred).'),
            max_wait_ms: z
                .number()
                .int()
                .positive()
                .max(300_000)
                .optional()
                .describe('Maximum time to wait in ms. Defaults to 300_000 (5 min, Redis TTL).'),
            interval_ms: z
                .number()
                .int()
                .positive()
                .max(10_000)
                .optional()
                .describe('Polling interval in ms. Defaults to 1_000.'),
        },
    }, async ({ sid, resource, action, max_wait_ms, interval_ms }) => {
        const trimmedSid = sid?.trim();
        const trimmedResource = resource?.trim();
        const trimmedAction = action?.trim();
        if (!trimmedSid && !(trimmedResource && trimmedAction)) {
            throw new Error('Provide sid, or both resource and action.');
        }
        const target = trimmedSid
            ? trimmedResource && trimmedAction
                ? {
                    sid: trimmedSid,
                    resource: trimmedResource,
                    action: trimmedAction,
                }
                : trimmedSid
            : { resource: trimmedResource, action: trimmedAction };
        const result = await backend.pollStepupSessionWait(target, {
            maxWaitMs: max_wait_ms,
            intervalMs: interval_ms,
        });
        if (result.outcome === 'verified' && result.sid) {
            backend.markStepupVerified(result.sid);
        }
        else if (result.sid &&
            (result.outcome === 'rejected' ||
                result.outcome === 'not_found' ||
                result.outcome === 'timeout')) {
            // Terminal for this wait: drop latch so Stop-hook MFA reminders stop.
            // Timeout leaves the backend session pending; a later explicit retry
            // can still reuse it via evaluate.
            backend.clearLatchBySid(result.sid);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: formatPollStepupSessionWaitAgentContext(),
                },
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: result.envelope.ok,
                        outcome: result.outcome,
                        attempts: result.attempts,
                        elapsed_ms: result.elapsedMs,
                        sid: result.sid,
                        raw: result.envelope.data,
                    }, null, 2),
                },
            ],
        };
    });
    server.registerTool('tc_inspect_stepup_state', {
        title: 'Inspect step-up state on disk',
        description: 'Single source of truth for what the step-up state files look ' +
            'like RIGHT NOW. Returns structured JSON for verified / pending / ' +
            'browser-lock records with explicit `age_ms`, `expired`, and ' +
            '`ttl_ms` fields so the agent never has to compute expiry from ' +
            'raw timestamps or trust a wrapped `ls` output. Strict read-only: ' +
            'this tool never consumes or rewrites any record. Call this ' +
            'BEFORE and AFTER any step-up flow to verify state transitions ' +
            'deterministically.',
        inputSchema: {},
    }, async () => {
        const snapshot = backend.inspectStepupState();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(snapshot, null, 2),
                },
            ],
        };
    });
    server.registerTool('tc_simulate_hook_invocation', {
        title: 'Invoke PreToolUse hook in a controlled subprocess',
        description: 'Spawns the actual PreToolUse hook binary with a Bash payload as ' +
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
                .describe('Bash command string. Builds tool_input={command} when tool_name is Bash and tool_input is not provided. Ignored if tool_input is set.'),
            cwd: z
                .string()
                .optional()
                .describe('Optional working directory passed to the hook payload. Defaults to process.cwd().'),
            tool_name: z
                .string()
                .min(1)
                .optional()
                .describe("Tool name to put in the PreToolUse payload. Defaults to 'Bash'. For MCP tool simulation use the wire name, e.g. 'tc_retire_member'."),
            tool_input: z
                .unknown()
                .optional()
                .describe('Raw tool_input object. Overrides the {command}-based default. Use for MCP tool simulation.'),
        },
    }, async ({ command, cwd, tool_name, tool_input }) => {
        const effectiveToolName = tool_name ?? 'Bash';
        const effectiveToolInput = tool_input !== undefined
            ? tool_input
            : command !== undefined
                ? { command }
                : {};
        if (effectiveToolName === 'Bash' &&
            !effectiveToolInput?.command) {
            return textResult('Rejected: Bash payload requires `command` (or `tool_input.command`).', true);
        }
        const before = backend.inspectStepupState();
        // Host-supplied plugin install root. Claude Code sets
        // CLAUDE_PLUGIN_ROOT; Codex CLI sets PLUGIN_ROOT (+ honors
        // CLAUDE_PLUGIN_ROOT as alias). Fail loudly when neither is
        // present — silently resolving relative to the package's dist
        // would point at the wrong directory now that the server lives
        // in a workspace package rather than the plugin tree.
        const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT?.trim() ||
            process.env.PLUGIN_ROOT?.trim();
        if (!pluginRoot) {
            return textResult('Rejected: CLAUDE_PLUGIN_ROOT (or PLUGIN_ROOT for Codex) must be set so the hook binary can be located.', true);
        }
        const hookPath = path.resolve(pluginRoot, 'dist/hooks/pre-tool-use.js');
        const payload = JSON.stringify({
            tool_name: effectiveToolName,
            tool_input: effectiveToolInput,
            cwd: cwd ?? process.cwd(),
        });
        const { stdout, stderr, exitCode } = await new Promise((resolve) => {
            const child = childSpawn('node', [hookPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
            child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
            child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
            child.on('error', () => resolve({ stdout, stderr, exitCode: -1 }));
            child.stdin.end(payload);
        });
        const after = backend.inspectStepupState();
        let parsedStdout = null;
        try {
            parsedStdout = stdout.trim() ? JSON.parse(stdout) : null;
        }
        catch {
            // Hook exited without JSON — leave parsedStdout as null and let
            // the agent inspect raw stdout below.
        }
        const denyEmitted = parsedStdout !== null &&
            typeof parsedStdout === 'object' &&
            parsedStdout.hookSpecificOutput !==
                undefined &&
            parsedStdout
                .hookSpecificOutput.permissionDecision === 'deny';
        // Guard v3: the only local state a hook mutates is the per-coordinate
        // latch set. A new latch after the run means a fresh step-up challenge
        // opened; a smaller set means a coordinate resolved (allow/self-heal).
        const latchCreated = after.latches.length > before.latches.length;
        const latchCleared = after.latches.length < before.latches.length;
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        deny_emitted: denyEmitted,
                        new_step_up_started: latchCreated && denyEmitted,
                        latch_created: latchCreated,
                        latch_cleared: latchCleared,
                        exit_code: exitCode,
                        stdout_json: parsedStdout,
                        stdout_raw: parsedStdout === null ? stdout : undefined,
                        stderr: stderr || undefined,
                        state_before: before,
                        state_after: after,
                    }, null, 2),
                },
            ],
        };
    });
    server.registerTool('tc_echo', {
        title: 'Echo',
        description: 'Echoes the given message back to the caller.',
        inputSchema: { message: z.string() },
    }, async ({ message }) => ({
        content: [{ type: 'text', text: `Echo: ${message}` }],
    }));
    server.registerTool('tc_simulate_command', {
        title: 'Simulate Bash hook gating (Guard v3)',
        description: 'Read-only check whether a Bash command would be intercepted by the PreToolUse hook. Guard v3 routes ALL Bash commands through POST /guard/evaluate — there is no local regex layer. Does NOT invoke the hook, open a browser, or write disk state. Use `tc_simulate_hook_invocation` for full-fidelity hook testing (including verified fast-path consumption).',
        inputSchema: { command: z.string().min(1) },
    }, async ({ command }) => {
        if (!backend.hasToken()) {
            return textResult(JSON.stringify({
                matched: true,
                will_trigger_hook: true,
                matched_by: 'block-no-token',
                command,
                note: 'No TRANSCODES_TOKEN configured — hook denies before POST /guard/evaluate.',
            }, null, 2));
        }
        return textResult(JSON.stringify({
            matched: true,
            will_trigger_hook: true,
            matched_by: 'guard-evaluate',
            command,
            note: 'All Bash commands reach POST /guard/evaluate. Outcome: permission 0=hard block, 1=allow, 2=step-up MFA. A valid verified record for this command may allow without re-prompting — use tc_simulate_hook_invocation to test.',
        }, null, 2));
    });
    server.registerPrompt('tc_greeting', {
        title: 'Greeting',
        description: 'Generate a greeting addressed to the given name.',
        argsSchema: { name: z.string() },
    }, ({ name }) => ({
        messages: [
            {
                role: 'user',
                content: { type: 'text', text: `Hello ${name}!` },
            },
        ],
    }));
    backend.registerBackendTools(server);
    server.registerResource('tc_tool_rules', 
    // Scheme must be WHATWG-legal (no underscore) — the MCP SDK parses the
    // URI with `new URL()` on every resources/read.
    'tc-tool-rules://list', {
        title: 'Step-up-protected MCP tool rules (system)',
        description: 'Read-only list of system MCP tool-rules from hooks/tool-rules.json. These gate built-in transcodes-guard MCP tools via execProtectedTool — external mcp__* tools use POST /guard/evaluate instead.',
        mimeType: 'text/markdown',
    }, async (uri) => ({
        contents: [
            {
                uri: uri.href,
                mimeType: 'text/markdown',
                text: formatToolRulesMarkdown(loadMergedToolRules()),
            },
        ],
    }));
    server.registerTool('tc_simulate_tool_call', {
        title: 'Simulate MCP hook gating',
        description: 'Given a full MCP wire tool name from a PreToolUse hook, report whether the hook would gate it. External mcp__* wire names are gated via POST /guard/evaluate. Built-in transcodes-guard MCP (registered tc_* names, exact set — bare or host-namespaced) skips the hook — execProtectedTool handler backstop applies. Read-only — does not invoke the hook or call the backend.',
        inputSchema: {
            tool_name: z.string().min(1).describe(MCP_TOOL_LOOKUP_NAME_GUIDANCE),
            tool_input: z.unknown().optional(),
        },
    }, async ({ tool_name }) => {
        if (isGuardToolName(tool_name)) {
            return textResult(JSON.stringify({
                tool_name,
                matched: false,
                will_trigger_hook: false,
                matched_by: 'transcodes-guard-handler',
                note: 'Built-in transcodes-guard MCP skips PreToolUse /guard/evaluate; execProtectedTool handler backstop applies.',
            }, null, 2));
        }
        if (isMcpWireToolName(tool_name)) {
            return textResult(JSON.stringify({
                tool_name,
                matched: true,
                will_trigger_hook: true,
                matched_by: 'guard-evaluate',
                note: 'External mcp__* wire names reach POST /guard/evaluate.',
            }, null, 2));
        }
        return textResult(JSON.stringify({
            tool_name,
            matched: false,
            will_trigger_hook: false,
            note: 'Non-MCP tool names are not gated by transcodes-guard at the PreToolUse hook.',
        }, null, 2));
    });
    return server;
}
//# sourceMappingURL=server.js.map