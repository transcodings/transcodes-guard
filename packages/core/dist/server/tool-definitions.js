/**
 * Definition data for the 8 core (host-agnostic) MCP tools — consumed by
 * `createServer()`'s registration loop and by the codegen pipeline
 * (`scripts/generate-router-files.mjs` reads the metadata only; handlers
 * are never invoked outside registration).
 *
 * `meta: true` marks the step-up infrastructure tools (create/poll/inspect)
 * — the set the backend mirrors in `guard.meta-tools.ts`. All backend
 * (gate-backend) tools are `meta: false` by definition; only core owns meta
 * tools.
 */
import { spawn as childSpawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, formatPollStepupSessionWaitAgentContext, } from '../contract/index.js';
import { isGuardToolName, isMcpWireToolName } from '../patterns/index.js';
const MCP_TOOL_LOOKUP_NAME_GUIDANCE = 'MCP full wire name from the host PreToolUse hook (e.g. mcp__mongodb__list_collections). External mcp__* names are gated via POST /guard/evaluate; built-in transcodes-guard MCP skips the hook (handler backstop only).';
function textResult(text, isError = false) {
    return {
        isError,
        content: [{ type: 'text', text }],
    };
}
export function coreToolDefinitions(backend) {
    return [
        defineTool({
            name: 'tc_create_stepup_session',
            title: 'Create Step-up MFA Session',
            description: 'Open a Transcodes step-up MFA session. Returns sid and the browser URL ' +
                'the user must visit to complete WebAuthn. The same flow is used by the ' +
                'PreToolUse hook when a danger command is detected.',
            summary: 'Open a WebAuthn step-up session; returns sid and browser URL.',
            category: 'Gate & Policies',
            access: 'gate',
            mutating: true,
            meta: true,
            stepUpProtected: false,
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
            handler: async ({ summary, action, resource, member_id }) => {
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
            },
        }),
        defineTool({
            name: 'tc_poll_stepup_session',
            title: 'Poll Step-up MFA Session',
            description: "Single GET against the step-up backend. Returns status 'pending', " +
                "'verified', or 'rejected'. Prefer resource+action (coordinate poll); " +
                'sid remains supported. Prefer `tc_poll_stepup_session_wait` for the ' +
                'deny-recovery loop.',
            summary: 'Single-shot poll of step-up session status (pending or verified).',
            category: 'Gate & Policies',
            access: 'gate',
            mutating: false,
            meta: true,
            stepUpProtected: false,
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
            handler: async ({ sid, resource, action }) => {
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
            },
        }),
        defineTool({
            name: 'tc_poll_stepup_session_wait',
            title: 'Wait for Step-up MFA Session',
            description: 'Block until the step-up session reaches `verified`, `rejected`, `not_found`, or ' +
                'the wait window elapses ' +
                '(default wait ~5 min, matching Redis TTL; poll every 1s). Prefer resource+action from the ' +
                'PreToolUse deny payload (coordinate poll). Optional sid still works. On verified retry ' +
                'the original command; on timeout, rejected, or not_found tell the user this command ' +
                'did not run, skip it, and continue other work. Do NOT re-poll or retry the SAME command ' +
                'unless the user explicitly asks to authenticate again. ' +
                'If the user says stop/cancel/skip at any time, abort this command and continue other work.',
            summary: 'Block until step-up reaches verified or timeout — use after a hook deny.',
            category: 'Gate & Policies',
            access: 'gate',
            mutating: false,
            meta: true,
            stepUpProtected: false,
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
            handler: async ({ sid, resource, action, max_wait_ms, interval_ms }) => {
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
                // No client-side bookkeeping on any outcome: the backend owns the
                // session's fate, and a verified coordinate is honored server-side
                // (StepUpSessionGuard reads the same coordinate cache — no sid handoff).
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
            },
        }),
        defineTool({
            name: 'tc_inspect_stepup_state',
            title: 'Inspect client step-up state',
            description: 'Reports what step-up state this client holds: nothing. Guard v3 ' +
                'keeps every status on the backend (reuse is keyed by the ' +
                'resource/action coordinate), so `client_state_files` is always ' +
                'empty and that emptiness is the answer — not a failure to look. ' +
                'To find out whether a coordinate is verified, poll the backend ' +
                'with `poll_stepup_session` / `poll_stepup_session_wait` instead. ' +
                'Strict read-only: writes and consumes nothing.',
            summary: 'Read-only snapshot of verified, pending, and browser-lock state files.',
            category: 'Gate & Policies',
            access: 'gate',
            mutating: false,
            meta: true,
            stepUpProtected: false,
            inputSchema: {},
            handler: async () => {
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
        }),
        defineTool({
            name: 'tc_simulate_hook_invocation',
            title: 'Invoke PreToolUse hook in a controlled subprocess',
            description: 'Spawns the actual PreToolUse hook binary with a Bash payload as ' +
                'stdin and reports what it decided (deny emitted? new step-up ' +
                'started?) plus raw stdout/stderr/exit — all in one structured ' +
                'response, so you never infer hook behaviour from `exit 127` or ' +
                '`ls` output. WARNING: this is NOT a dry run — the hook calls the ' +
                'backend and may create a step-up session and open a browser tab. ' +
                'Use it the way you would a real hook invocation, not as a ' +
                'side-effect-free probe.',
            summary: 'Spawn the real hook binary and diff step-up state before/after.',
            category: 'Gate & Policies',
            access: 'gate',
            mutating: false,
            meta: false,
            stepUpProtected: false,
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
            handler: async ({ command, cwd, tool_name, tool_input }) => {
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
                // Guard v3 hooks mutate no local state (t3), so a before/after file diff
                // can no longer tell us what happened. Read the hook's structured stderr
                // tag instead of grepping the deny prose: `formatStderrTag` emits exactly
                // one machine-readable line per decision kind (contract/messages.ts), and
                // only STEPUP-CHALLENGED names a freshly minted session. Matching the
                // human-facing reason text would re-break the moment that copy is
                // reworded, and would false-positive on any other deny that happens to
                // quote a sid (a create-failed detail, for one). The line anchor is only
                // trustworthy because `formatStderrTag` folds the command it interpolates
                // to a single line — a raw command could otherwise forge a tag line.
                const stepUpTag = /^transcodes-guard: STEPUP-CHALLENGED sid=(\S+)/m.exec(stderr);
                const newStepUpStarted = stepUpTag !== null;
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                deny_emitted: denyEmitted,
                                new_step_up_started: newStepUpStarted,
                                // The sid the hook actually minted, straight from the tag —
                                // so the agent can poll without scraping it out of the prose.
                                step_up_sid: stepUpTag?.[1],
                                exit_code: exitCode,
                                stdout_json: parsedStdout,
                                stdout_raw: parsedStdout === null ? stdout : undefined,
                                stderr: stderr || undefined,
                            }, null, 2),
                        },
                    ],
                };
            },
        }),
        defineTool({
            name: 'tc_echo',
            title: 'Echo',
            description: 'Echoes the given message back to the caller.',
            summary: 'Health-check tool that echoes a message back to the caller.',
            category: 'Gate & Policies',
            access: 'gate',
            mutating: false,
            meta: false,
            stepUpProtected: false,
            inputSchema: { message: z.string() },
            handler: async ({ message }) => ({
                content: [{ type: 'text', text: `Echo: ${message}` }],
            }),
        }),
        defineTool({
            name: 'tc_simulate_command',
            title: 'Simulate Bash hook gating (Guard v3)',
            description: 'Read-only check whether a Bash command would be intercepted by the PreToolUse hook. Guard v3 routes ALL Bash commands through POST /guard/evaluate — there is no local regex layer. Does NOT invoke the hook, open a browser, or write disk state. Use `tc_simulate_hook_invocation` for full-fidelity hook testing (including verified fast-path consumption).',
            summary: 'Read-only check whether a Bash command would reach POST /guard/evaluate in the PreToolUse hook.',
            category: 'Gate & Policies',
            access: 'gate',
            mutating: false,
            meta: false,
            stepUpProtected: false,
            inputSchema: { command: z.string().min(1) },
            handler: async ({ command }) => {
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
            },
        }),
        defineTool({
            name: 'tc_simulate_tool_call',
            title: 'Simulate MCP hook gating',
            description: 'Given a full MCP wire tool name from a PreToolUse hook, report whether the hook would gate it. External mcp__* wire names are gated via POST /guard/evaluate. Built-in transcodes-guard MCP (registered tc_* names, exact set — bare or host-namespaced) skips the hook — the backend StepUpSessionGuard enforces step-up on the API call itself. Read-only — does not invoke the hook or call the backend.',
            summary: 'Report whether a full MCP wire tool name would be gated by the PreToolUse hook (POST /guard/evaluate).',
            category: 'Gate & Policies',
            access: 'gate',
            mutating: false,
            meta: false,
            stepUpProtected: false,
            inputSchema: {
                tool_name: z.string().min(1).describe(MCP_TOOL_LOOKUP_NAME_GUIDANCE),
                tool_input: z.unknown().optional(),
            },
            handler: async ({ tool_name }) => {
                if (isGuardToolName(tool_name)) {
                    return textResult(JSON.stringify({
                        tool_name,
                        matched: false,
                        will_trigger_hook: false,
                        matched_by: 'transcodes-guard-handler',
                        note: 'Built-in transcodes-guard MCP skips PreToolUse /guard/evaluate; the backend StepUpSessionGuard enforces step-up on the API call itself.',
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
            },
        }),
    ];
}
//# sourceMappingURL=tool-definitions.js.map