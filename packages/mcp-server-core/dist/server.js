import { spawn as childSpawn } from "node:child_process";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addUserPattern, findFirstMatch, getUserPatternsPath, loadMergedPatterns, PatternValidationError, removeUserPattern, updateUserPattern, } from "@transcodes-guard/danger-patterns";
import { addUserToolRule, findFirstToolRule, getUserToolRulesPath, loadMergedToolRules, removeUserToolRule, ToolRuleValidationError, updateUserToolRule, } from "@transcodes-guard-private/danger-rules";
import { createStepupSession, inspectStepupState, isTrackerEnabled, loadStepupConfig, markVerified, parseMemberAccessToken, pollStepupSession, pollStepupSessionWait, resolveToken, setTrackerEnabled, transcodesConfigFile, writeVerified, } from "@transcodes-guard-private/stepup-core";
import { registerAuditTools, registerAuthDeviceTools, registerJwkTools, registerMemberTools, registerMembershipTools, registerMetaTools, registerOrganizationTools, registerPasscodeTools, registerProjectTools, registerRbacTools, } from "@transcodes-guard-private/transcodes-mcp-tools";
function formatPatternsMarkdown(patterns) {
    const lines = [
        "# Blocked Bash command patterns",
        "",
        `${patterns.length} pattern(s) intercept Bash invocations before execution.`,
        `User patterns live at \`${getUserPatternsPath()}\` and are editable through the \`add_user_pattern\`/\`update_user_pattern\`/\`remove_user_pattern\` tools. System patterns are immutable.`,
        "",
        "| source | id | reason | regex |",
        "| ------ | -- | ------ | ----- |",
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
        "| ------ | -- | -------- | ------ | ------ | -------- | --------------- |",
    ];
    for (const r of rules) {
        lines.push(`| ${r.source} | \`${r.id}\` | \`${r.toolName}\` | ${r.reason} | ${r.stepupAction} | ${r.stepupResource} | ${r.consume_in_hook ?? false} |`);
    }
    return lines.join("\n");
}
function textResult(text, isError = false) {
    return {
        isError,
        content: [{ type: "text", text }],
    };
}
export function createServer() {
    const server = new McpServer({
        name: "transcodes-guard-mcp",
        version: "0.1.0",
    });
    server.registerResource("danger-patterns", "danger-patterns://list", {
        title: "Blocked Bash patterns",
        description: `Regex patterns the PreToolUse hook uses to block dangerous Bash commands. Merges immutable system patterns (hooks/danger-patterns.json) with user patterns (${getUserPatternsPath()}, JSONC — comments allowed for hand-edits), read fresh at every request.`,
        mimeType: "text/markdown",
    }, async (uri) => ({
        contents: [
            {
                uri: uri.href,
                mimeType: "text/markdown",
                text: formatPatternsMarkdown(loadMergedPatterns()),
            },
        ],
    }));
    server.registerTool("simulate_command", {
        title: "Simulate command against block patterns",
        description: "Check whether a specific Bash command would be blocked by the PreToolUse hook's regex layer. Call this whenever the user mentions a concrete command and asks if it is dangerous, safe, blocked, intercepted, allowed, or whether the hook/danger-patterns would catch it — including Korean phrasings like '이 명령 차단될까', '이거 hook에 걸려?', 'rm -rf src 실행해도 돼?', '미리 검사해줘'. Runs against the union of system and user patterns. Does NOT simulate the second-layer `rm -rf` git-tracked check (cwd-dependent), so the hook may still block commands this tool reports as allowed.",
        inputSchema: { command: z.string().min(1) },
    }, async ({ command }) => {
        const patterns = loadMergedPatterns();
        const hit = findFirstMatch(command, patterns);
        // The two layers must be reported separately. The regex layer always
        // runs inside the simulator (and inside the hook process if it
        // spawns), but Claude Code's actual PreToolUse trigger empirically
        // only fires for *system* patterns — user patterns may be matched
        // here yet never reach the hook in production. Surfacing the
        // distinction prevents agents from inferring "matched in simulator
        // ⇒ will block in hook".
        if (!hit) {
            return textResult(JSON.stringify({
                matched: false,
                will_trigger_hook: false,
                patterns_checked: patterns.length,
                note: "Hook may still block via the rm -rf git-tracked semantic check; simulator does not cover that layer.",
            }, null, 2));
        }
        const m = hit.matched;
        return textResult(JSON.stringify({
            matched: true,
            matched_by: m.source,
            pattern_id: m.id,
            reason: m.reason,
            regex: m.regex,
            will_trigger_hook: m.source === "system",
            note: m.source === "user"
                ? "User patterns are matched by the simulator but do NOT reliably trigger Claude Code's actual PreToolUse hook. Use only system patterns for live verification."
                : "System pattern: Claude Code will route a matching Bash command through the PreToolUse hook.",
        }, null, 2));
    });
    server.registerTool("add_user_pattern", {
        title: "Add user danger pattern",
        description: `Register a new user-owned block pattern that the PreToolUse hook will enforce. Call when the user asks to add/register/block a new pattern, ban a command, or extend danger-patterns — e.g. '패턴 추가해줘', 'sudo 막아줘', '이런 명령도 차단되게 해줘'. id must be unique across both system and user patterns; regex must compile. Persisted to ${getUserPatternsPath()} (JSONC) and effective on the next hook invocation.`,
        inputSchema: {
            id: z
                .string()
                .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumeric + hyphen"),
            regex: z.string().min(1),
            reason: z.string().min(1),
        },
    }, async (input) => {
        try {
            const saved = addUserPattern(input);
            return textResult(`Added user pattern \`${saved.id}\`.\nregex: ${saved.regex}\nreason: ${saved.reason}`);
        }
        catch (e) {
            if (e instanceof PatternValidationError) {
                return textResult(`Rejected: ${e.message}`, true);
            }
            throw e;
        }
    });
    server.registerTool("update_user_pattern", {
        title: "Update user danger pattern",
        description: "Modify regex or reason of an existing user pattern. Call when the user asks to edit/change/수정 a pattern by id — e.g. 'no-sudo 패턴 reason 바꿔줘', 'regex 수정해줘'. System patterns cannot be modified; attempts are rejected. Pass only the fields you want to change.",
        inputSchema: {
            id: z.string().min(1),
            regex: z.string().min(1).optional(),
            reason: z.string().min(1).optional(),
        },
    }, async ({ id, regex, reason }) => {
        if (regex === undefined && reason === undefined) {
            return textResult("Rejected: provide at least one of `regex` or `reason` to update.", true);
        }
        try {
            const saved = updateUserPattern(id, { regex, reason });
            return textResult(`Updated user pattern \`${saved.id}\`.\nregex: ${saved.regex}\nreason: ${saved.reason}`);
        }
        catch (e) {
            if (e instanceof PatternValidationError) {
                return textResult(`Rejected: ${e.message}`, true);
            }
            throw e;
        }
    });
    server.registerTool("remove_user_pattern", {
        title: "Remove user danger pattern",
        description: "Delete an existing user pattern by id. Call when the user asks to remove/삭제/제거/취소 a pattern — e.g. 'no-sudo 패턴 삭제해줘', '내가 추가한 거 빼줘'. System patterns cannot be removed; attempts are rejected.",
        inputSchema: { id: z.string().min(1) },
    }, async ({ id }) => {
        try {
            removeUserPattern(id);
            return textResult(`Removed user pattern \`${id}\`.`);
        }
        catch (e) {
            if (e instanceof PatternValidationError) {
                return textResult(`Rejected: ${e.message}`, true);
            }
            throw e;
        }
    });
    server.registerTool("create_stepup_session", {
        title: "Create Step-up MFA Session",
        description: "Open a Transcodes step-up MFA session. Returns sid and the browser URL " +
            "the user must visit to complete WebAuthn. The same flow is used by the " +
            "PreToolUse hook when a danger command is detected.",
        inputSchema: {
            comment: z
                .string()
                .min(1)
                .describe("One short sentence shown on the step-up screen explaining the reason."),
            action: z
                .string()
                .optional()
                .describe("Action identifier for the audit log."),
            resource: z
                .string()
                .optional()
                .describe("Protected resource identifier for the audit log."),
            member_id: z
                .string()
                .optional()
                .describe("Member public id to authenticate. Defaults to the mid claim in TRANSCODES_TOKEN."),
        },
    }, async ({ comment, action, resource, member_id }) => {
        const config = loadStepupConfig();
        const result = await createStepupSession(config, {
            comment,
            action,
            resource,
            member_id,
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
                        raw: result.envelope.data,
                    }, null, 2),
                },
            ],
        };
    });
    server.registerTool("poll_stepup_session", {
        title: "Poll Step-up MFA Session",
        description: "Single GET against the step-up backend. Returns status 'pending' or " +
            "'verified'. On verified the result is cached cross-platform so a " +
            "subsequent danger command in the hook can pass without re-prompting. " +
            "Prefer `poll_stepup_session_wait` for the deny-recovery loop — it " +
            "blocks until verified in one call instead of requiring 60 manual " +
            "iterations.",
        inputSchema: {
            sid: z
                .string()
                .min(1)
                .describe("Session id returned from create_stepup_session."),
        },
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
                        raw: result.envelope.data,
                    }, null, 2),
                },
            ],
        };
    });
    server.registerTool("poll_stepup_session_wait", {
        title: "Wait for Step-up MFA Session",
        description: "Block until the step-up session reaches `verified` or the wait window " +
            "elapses (default 60s, polling every 1s). Use this — NOT the single-shot " +
            "`poll_stepup_session` — as the next action after a PreToolUse deny " +
            "carrying a step-up sid. One call replaces the 60-iteration polling " +
            "loop. On `outcome: \"verified\"` retry the original Bash command; on " +
            "`outcome: \"timeout\"` ask the user to complete WebAuthn and call this " +
            "tool again. Do NOT ask the user to confirm completion before calling " +
            "this tool — it waits on the user's behalf.",
        inputSchema: {
            sid: z
                .string()
                .min(1)
                .describe("Session id returned from create_stepup_session."),
            max_wait_ms: z
                .number()
                .int()
                .positive()
                .max(300_000)
                .optional()
                .describe("Maximum time to wait in ms. Defaults to 60_000."),
            interval_ms: z
                .number()
                .int()
                .positive()
                .max(10_000)
                .optional()
                .describe("Polling interval in ms. Defaults to 1_000."),
        },
    }, async ({ sid, max_wait_ms, interval_ms }) => {
        const config = loadStepupConfig();
        const result = await pollStepupSessionWait(config, sid, {
            maxWaitMs: max_wait_ms,
            intervalMs: interval_ms,
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
                        raw: result.envelope.data,
                    }, null, 2),
                },
            ],
        };
    });
    server.registerTool("inspect_stepup_state", {
        title: "Inspect step-up state on disk",
        description: "Single source of truth for what the step-up state files look " +
            "like RIGHT NOW. Returns structured JSON for verified / pending / " +
            "browser-lock records with explicit `age_ms`, `expired`, and " +
            "`ttl_ms` fields so the agent never has to compute expiry from " +
            "raw timestamps or trust a wrapped `ls` output. Strict read-only: " +
            "this tool never consumes or rewrites any record. Call this " +
            "BEFORE and AFTER any step-up flow to verify state transitions " +
            "deterministically.",
        inputSchema: {},
    }, async () => {
        const snapshot = inspectStepupState();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(snapshot, null, 2),
                },
            ],
        };
    });
    server.registerTool("get_tracker_status", {
        title: "Get transcodes-guard gate status",
        description: "Report whether the transcodes-guard step-up gate is currently " +
            "enabled, plus the active token source and its expiry. Read-only. " +
            "Call when the user asks if the tracker/hook/protection is on or off " +
            "— e.g. '트래커 켜져 있어?', 'hook 활성화 상태야?', 'is the gate enabled?'. " +
            "The enabled flag lives in the same file as the token " +
            `(${transcodesConfigFile()}); a missing flag means enabled.`,
        inputSchema: {},
    }, async () => {
        const enabled = isTrackerEnabled();
        const { token, source } = resolveToken();
        let tokenSummary = null;
        if (token) {
            try {
                const parsed = parseMemberAccessToken(token);
                tokenSummary = `member=${parsed.claims.memberId} project=${parsed.claims.projectId} expires=${new Date(parsed.claims.exp * 1000).toISOString()}`;
            }
            catch {
                tokenSummary = "present but undecodable";
            }
        }
        return textResult(JSON.stringify({
            enabled,
            config_file: transcodesConfigFile(),
            token_source: source,
            token: tokenSummary,
        }, null, 2));
    });
    server.registerTool("set_tracker_enabled", {
        title: "Re-enable the transcodes-guard gate",
        description: "Re-ENABLE the transcodes-guard step-up gate across all hosts. " +
            "This tool can only turn protection ON — it deliberately REFUSES " +
            "`enabled=false`. Disabling the gate is a privilege reduction that " +
            "must be a human, out-of-band action (the agent could otherwise " +
            "disable its own guardrails via prompt injection), so disabling is " +
            "only possible by running `transcodes disable` in a terminal. Call " +
            "this when the user asks to turn the tracker/hook/protection back " +
            "ON — e.g. '트래커 다시 켜줘', 'enable the gate', 'turn protection " +
            `back on'. Persists to ${transcodesConfigFile()}; effective on the ` +
            "next hook invocation (no restart needed).",
        inputSchema: {
            enabled: z
                .boolean()
                .describe("Must be true. This tool only re-enables the gate; pass true to turn protection on. false is refused — disable via `transcodes disable` in a terminal."),
        },
    }, async ({ enabled }) => {
        if (!enabled) {
            return textResult("Refused: the gate cannot be disabled through an MCP tool — that " +
                "would let an agent switch off its own step-up protection. To " +
                "disable, the human operator must run `transcodes disable` in a " +
                "terminal (out-of-band from this agent).", true);
        }
        try {
            setTrackerEnabled(true);
        }
        catch (e) {
            return textResult(`Failed to enable gate: ${e instanceof Error ? e.message : String(e)}`, true);
        }
        return textResult("transcodes-guard gate ENABLED. Danger commands and protected MCP tools will require step-up MFA again.");
    });
    server.registerTool("simulate_hook_invocation", {
        title: "Invoke PreToolUse hook in a controlled subprocess",
        description: "Spawns the actual PreToolUse hook binary with a Bash payload as " +
            "stdin, captures stdout/stderr/exit, and diffs the step-up state " +
            "files before/after — all in one structured response. Use this " +
            "when you need to verify hook behaviour (fast-path consumption, " +
            "deny emission, new step-up start) without inferring from `exit " +
            "127` or `ls` output. WARNING: this is NOT a dry run — the hook " +
            "may consume the verified record or create a new step-up session " +
            "and open a browser tab if a danger pattern is hit. Use it the " +
            "way you would a real hook invocation, not as a side-effect-free " +
            "probe.",
        inputSchema: {
            command: z
                .string()
                .min(1)
                .optional()
                .describe("Bash command string. Builds tool_input={command} when tool_name is Bash and tool_input is not provided. Ignored if tool_input is set."),
            cwd: z
                .string()
                .optional()
                .describe("Optional working directory passed to the hook payload. Defaults to process.cwd()."),
            tool_name: z
                .string()
                .min(1)
                .optional()
                .describe("Tool name to put in the PreToolUse payload. Defaults to 'Bash'. For MCP tool simulation use the wire name, e.g. 'mcp__plugin_transcodes-guard_transcodes-guard__retire_member'."),
            tool_input: z
                .unknown()
                .optional()
                .describe("Raw tool_input object. Overrides the {command}-based default. Use for MCP tool simulation."),
        },
    }, async ({ command, cwd, tool_name, tool_input }) => {
        const effectiveToolName = tool_name ?? "Bash";
        const effectiveToolInput = tool_input !== undefined
            ? tool_input
            : command !== undefined
                ? { command }
                : {};
        if (effectiveToolName === "Bash" &&
            !effectiveToolInput?.command) {
            return textResult("Rejected: Bash payload requires `command` (or `tool_input.command`).", true);
        }
        const before = inspectStepupState();
        // Host-supplied plugin install root. Claude Code sets
        // CLAUDE_PLUGIN_ROOT; Codex CLI sets PLUGIN_ROOT (+ honors
        // CLAUDE_PLUGIN_ROOT as alias). Fail loudly when neither is
        // present — silently resolving relative to the package's dist
        // would point at the wrong directory now that the server lives
        // in a workspace package rather than the plugin tree.
        const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT?.trim() ||
            process.env.PLUGIN_ROOT?.trim();
        if (!pluginRoot) {
            return textResult("Rejected: CLAUDE_PLUGIN_ROOT (or PLUGIN_ROOT for Codex) must be set so the hook binary can be located.", true);
        }
        const hookPath = path.resolve(pluginRoot, "dist/hooks/pre-tool-use.js");
        const payload = JSON.stringify({
            tool_name: effectiveToolName,
            tool_input: effectiveToolInput,
            cwd: cwd ?? process.cwd(),
        });
        const { stdout, stderr, exitCode } = await new Promise((resolve) => {
            const child = childSpawn("node", [hookPath], {
                stdio: ["pipe", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (b) => (stdout += b.toString("utf8")));
            child.stderr.on("data", (b) => (stderr += b.toString("utf8")));
            child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
            child.on("error", () => resolve({ stdout, stderr, exitCode: -1 }));
            child.stdin.end(payload);
        });
        const after = inspectStepupState();
        let parsedStdout = null;
        try {
            parsedStdout = stdout.trim() ? JSON.parse(stdout) : null;
        }
        catch {
            // Hook exited without JSON — leave parsedStdout as null and let
            // the agent inspect raw stdout below.
        }
        const denyEmitted = parsedStdout !== null &&
            typeof parsedStdout === "object" &&
            parsedStdout.hookSpecificOutput !==
                undefined &&
            parsedStdout.hookSpecificOutput.permissionDecision === "deny";
        const verifiedConsumed = before.verified.exists && !after.verified.exists;
        const pendingCleared = before.pending.exists && !after.pending.exists;
        const newPendingStarted = !before.pending.exists ||
            (before.pending.exists &&
                after.pending.exists &&
                before.pending.sid !== after.pending.sid)
            ? after.pending.exists
            : false;
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
                        stdout_raw: parsedStdout === null ? stdout : undefined,
                        stderr: stderr || undefined,
                        state_before: before,
                        state_after: after,
                    }, null, 2),
                },
            ],
        };
    });
    server.registerTool("echo", {
        title: "Echo",
        description: "Echoes the given message back to the caller.",
        inputSchema: { message: z.string() },
    }, async ({ message }) => ({
        content: [{ type: "text", text: `Echo: ${message}` }],
    }));
    server.registerPrompt("greeting", {
        title: "Greeting",
        description: "Generate a greeting addressed to the given name.",
        argsSchema: { name: z.string() },
    }, ({ name }) => ({
        messages: [
            {
                role: "user",
                content: { type: "text", text: `Hello ${name}!` },
            },
        ],
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
        mimeType: "text/markdown",
    }, async (uri) => ({
        contents: [
            {
                uri: uri.href,
                mimeType: "text/markdown",
                text: formatToolRulesMarkdown(loadMergedToolRules()),
            },
        ],
    }));
    server.registerTool("add_tool_rule", {
        title: "Add user MCP tool-rule",
        description: `Register a new user-owned tool-rule that the PreToolUse hook enforces (deny + step-up + retry) when a matching MCP tool is called. id must be unique across system and user rules; persisted to ${getUserToolRulesPath()} (JSONC).`,
        inputSchema: {
            id: z
                .string()
                .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumeric + hyphen"),
            toolName: z.string().min(1),
            reason: z.string().min(1),
            stepupAction: z.string().min(1),
            stepupResource: z.string().min(1),
            consume_in_hook: z
                .boolean()
                .optional()
                .describe("When true (default for user rules), the PreToolUse hook consumes the verified record itself (Bash-like fast-path). Set false ONLY if the tool handler threads the sid via `withStepupVerifiedSid` to a backend that requires the X-Step-Up-Session-Id header."),
        },
    }, async (input) => {
        try {
            const saved = addUserToolRule(input);
            return textResult(`Added user tool-rule \`${saved.id}\`.\ntoolName: ${saved.toolName}\nreason: ${saved.reason}\naction: ${saved.stepupAction}\nresource: ${saved.stepupResource}\nconsume_in_hook: ${saved.consume_in_hook ?? true}`);
        }
        catch (e) {
            if (e instanceof ToolRuleValidationError) {
                return textResult(`Rejected: ${e.message}`, true);
            }
            throw e;
        }
    });
    server.registerTool("update_tool_rule", {
        title: "Update user MCP tool-rule",
        description: "Modify fields of an existing user tool-rule. System rules cannot be modified.",
        inputSchema: {
            id: z.string().min(1),
            toolName: z.string().min(1).optional(),
            reason: z.string().min(1).optional(),
            stepupAction: z.string().min(1).optional(),
            stepupResource: z.string().min(1).optional(),
            consume_in_hook: z
                .boolean()
                .optional()
                .describe("Override the hook-side consume behavior. true = hook consumes immediately (no wrapper needed); false = handler consumes via withStepupVerifiedSid."),
        },
    }, async ({ id, toolName, reason, stepupAction, stepupResource, consume_in_hook }) => {
        if (toolName === undefined &&
            reason === undefined &&
            stepupAction === undefined &&
            stepupResource === undefined &&
            consume_in_hook === undefined) {
            return textResult("Rejected: provide at least one of `toolName`, `reason`, `stepupAction`, `stepupResource`, or `consume_in_hook` to update.", true);
        }
        try {
            const saved = updateUserToolRule(id, {
                toolName,
                reason,
                stepupAction,
                stepupResource,
                consume_in_hook,
            });
            return textResult(`Updated user tool-rule \`${saved.id}\`.\ntoolName: ${saved.toolName}\nreason: ${saved.reason}\naction: ${saved.stepupAction}\nresource: ${saved.stepupResource}\nconsume_in_hook: ${saved.consume_in_hook ?? true}`);
        }
        catch (e) {
            if (e instanceof ToolRuleValidationError) {
                return textResult(`Rejected: ${e.message}`, true);
            }
            throw e;
        }
    });
    server.registerTool("remove_tool_rule", {
        title: "Remove user MCP tool-rule",
        description: "Delete an existing user tool-rule by id. System rules cannot be removed.",
        inputSchema: { id: z.string().min(1) },
    }, async ({ id }) => {
        try {
            removeUserToolRule(id);
            return textResult(`Removed user tool-rule \`${id}\`.`);
        }
        catch (e) {
            if (e instanceof ToolRuleValidationError) {
                return textResult(`Rejected: ${e.message}`, true);
            }
            throw e;
        }
    });
    server.registerTool("simulate_tool_call", {
        title: "Simulate a tool-rule lookup",
        description: "Given a tool_name (and optional tool_input), report whether any system or user tool-rule matches. Read-only — does not invoke the hook or call the backend. Use to verify a rule's coverage before relying on it.",
        inputSchema: {
            tool_name: z.string().min(1),
            tool_input: z.unknown().optional(),
        },
    }, async ({ tool_name }) => {
        const rules = loadMergedToolRules();
        const match = findFirstToolRule(tool_name, rules);
        if (!match) {
            return textResult(JSON.stringify({ tool_name, matched: false, rule_count: rules.length }, null, 2));
        }
        const r = match.matched;
        return textResult(JSON.stringify({
            tool_name,
            matched: true,
            rule: {
                id: r.id,
                source: r.source,
                toolName: r.toolName,
                reason: r.reason,
                stepupAction: r.stepupAction,
                stepupResource: r.stepupResource,
            },
        }, null, 2));
    });
    return server;
}
//# sourceMappingURL=server.js.map