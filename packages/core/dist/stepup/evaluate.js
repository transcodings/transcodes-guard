/**
 * Host-agnostic PreToolUse gate decision (Guard v3, backend-as-SSOT).
 *
 * Every host's hook entrypoint is a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision shape
 * drives Claude Code, Codex, Cursor, and Antigravity.
 *
 * Guard v3 grouping: every host tool call (except built-in transcodes-guard
 * MCP and host meta-tool bypass sets below) → `POST /guard/evaluate` with the
 * raw hook stdin JSON as `payload` and a client-minted per-prompt `sid`. The
 * backend is the single source of truth for step-up status; the client keeps
 * NO on-disk verified/pending records — only a per-coordinate latch (`latch.ts`)
 * that dedupes the browser launch across the N concurrent tool calls of one prompt.
 *
 * Fail policy:
 *  - Before classify (stdin parse) → `proceed-ungated` (fail-open); the caller
 *    exits 0 with no JSON.
 *  - After classify, no token → `block-no-token` (fail-closed).
 *  - After classify, backend unreachable / unparseable → permission 2
 *    (step-up); a null verdict without a session becomes
 *    `block-stepup-create-failed`.
 */
import { currentHostProvider, DEFAULT_RBAC_RESOURCE, isTranscodesGuardWireToolName, } from '../patterns/index.js';
import { loadStepupConfig } from './config.js';
import { openBrowser } from './gate.js';
import { clearLatch, hasLatch, readLatchRecord, readSinglePendingLatchSid, writeLatch, } from './latch.js';
import { evaluateAction } from './rbac-check.js';
import { resolvePromptGroup } from './sid.js';
import { resolveToken } from './token-store.js';
/**
 * Runtime + type-level kind constants for `GateDecision`. Source of truth for
 * the discriminated union below and every `switch`/comparison across the
 * codebase. Re-exported as the contract surface (`../contract/types.ts`) —
 * changing this constant or the union changes the GateBackend contract.
 */
export const GATE_DECISION_KIND = {
    PROCEED_UNGATED: 'proceed-ungated',
    PROCEED_BY_POLICY: 'proceed-by-policy',
    BLOCK_NO_TOKEN: 'block-no-token',
    BLOCK_BY_POLICY: 'block-by-policy',
    BLOCK_STEPUP_CREATE_FAILED: 'block-stepup-create-failed',
    BLOCK_STEPUP_CHALLENGED: 'block-stepup-challenged',
    /** Terminal: user declined MFA for this grouped challenge — do not poll/retry. */
    BLOCK_STEPUP_REJECTED: 'block-stepup-rejected',
};
const GUARD_EVALUATE_RULE_ID = 'guard-evaluate';
function resolvePayload(input) {
    return (input.rawPayload ?? {
        tool_name: input.toolName,
        tool_input: input.toolInput,
        cwd: input.cwd,
    });
}
function shellCommand(toolInput) {
    const o = toolInput;
    if (typeof o?.command === 'string')
        return o.command;
    if (typeof o?.CommandLine === 'string')
        return o.CommandLine;
    return undefined;
}
function wireToolName(input) {
    return input.toolName !== 'Unknown' ? input.toolName : undefined;
}
/**
 * Claude Code — harness meta tools (no shell/MCP reach). Gating ToolSearch etc.
 * causes Stop-reminder deadlock. Always gated: `Bash`, any `mcp_*` / `mcp__*`.
 */
const CLAUDE_INTERNAL_TOOL_REGEX = /^(ToolSearch|TodoWrite|TodoRead|TaskCreate|TaskUpdate|TaskList|AskUserQuestion|EnterPlanMode|ExitPlanMode|exit_plan_mode)$/;
const CLAUDE_GATED_WIRE_NAMES = new Set(['Bash']);
function isClaudeInternalTool(name) {
    if (CLAUDE_GATED_WIRE_NAMES.has(name))
        return false;
    if (/^mcp_/i.test(name))
        return false;
    return CLAUDE_INTERNAL_TOOL_REGEX.test(name);
}
/**
 * Cursor Agent — wire names from docs matcher + common built-ins.
 * Always gated: `Shell`, any `mcp_*` / `mcp__*`.
 * @see https://cursor.com/docs/hooks (preToolUse: Shell|Read|Write|Grep|Delete|Task|…)
 */
const CURSOR_INTERNAL_TOOL_REGEX = /^(Read|Write|Grep|Delete|Glob|SemanticSearch|StrReplace|SwitchMode|TodoWrite|todo_write|AskQuestion|ask_question|Task|WebSearch|WebFetch|GenerateImage|EditNotebook|Await)$/i;
const CURSOR_GATED_WIRE_NAMES = new Set(['Shell']);
function isCursorInternalTool(name) {
    if (CURSOR_GATED_WIRE_NAMES.has(name))
        return false;
    if (/^mcp_/i.test(name))
        return false;
    return CURSOR_INTERNAL_TOOL_REGEX.test(name);
}
/**
 * OpenAI Codex CLI — snake_case harness tools (published function list).
 * Always gated: `Bash`, `exec_command`, `apply_patch`, `parallel`, `write_stdin`,
 * any `mcp_*` / `mcp__*`.
 */
const CODEX_INTERNAL_TOOL_REGEX = /^(view_image|update_plan|request_user_input|list_mcp_resources|list_mcp_resource_templates|read_mcp_resource|list_available_plugins_to_install|request_plugin_install|get_goal|create_goal|update_goal|load_workspace_dependencies|navigate_to_codex_page|read_thread_terminal|read_thread|list_threads|list_projects|send_message_to_thread|create_thread|fork_thread|handoff_thread|set_thread_title|set_thread_pinned|set_thread_archived|automation_update|tool_search_tool|imagegen|run)$/;
const CODEX_GATED_WIRE_NAMES = new Set([
    'Bash',
    'exec_command',
    'apply_patch',
    'parallel',
    'write_stdin',
]);
function isCodexInternalTool(name) {
    if (CODEX_GATED_WIRE_NAMES.has(name))
        return false;
    if (/^mcp_/i.test(name))
        return false;
    return CODEX_INTERNAL_TOOL_REGEX.test(name);
}
/**
 * Google Antigravity — wire names matched by regex (no published function list).
 * Always gated: `run_command`, `call_mcp_tool`, `terminal*`, any `mcp_*` / `mcp__*`.
 */
const ANTIGRAVITY_INTERNAL_TOOL_REGEX = /^(?!mcp__)(editor|files?|filesystem|code[_-]?search|file[_-]?editing|web[_-]?search|browser|browser[_-]?subagent|artifacts?|task[_-]?plan|implementation[_-]?plan|walkthrough|subagents?)([._:-]?[A-Za-z0-9_]+)*$/i;
const ANTIGRAVITY_GATED_WIRE_NAMES = new Set(['run_command', 'call_mcp_tool']);
function isAntigravityInternalTool(name) {
    if (ANTIGRAVITY_GATED_WIRE_NAMES.has(name))
        return false;
    if (/^mcp_/i.test(name))
        return false;
    if (/^terminal/i.test(name))
        return false;
    return ANTIGRAVITY_INTERNAL_TOOL_REGEX.test(name);
}
function isHostMetaTool(name) {
    return (isClaudeInternalTool(name) ||
        isCursorInternalTool(name) ||
        isCodexInternalTool(name) ||
        isAntigravityInternalTool(name));
}
function summarizePayload(payload) {
    try {
        const s = JSON.stringify(payload);
        if (s === undefined)
            return '[unserializable]';
        return s.length > 200 ? `${s.slice(0, 197)}...` : s;
    }
    catch {
        return '[unserializable]';
    }
}
function classifyToolCall(input) {
    const name = wireToolName(input);
    if (name && isTranscodesGuardWireToolName(name))
        return null;
    // DO NOT DELETE THIS COMMENT. Leave this comment for further development.
    // if (name && isHostMetaTool(name)) return null;
    const payload = resolvePayload(input);
    const cmd = shellCommand(input.toolInput);
    const label = name ?? 'tool';
    const blob = summarizePayload(payload);
    const summary = cmd ?? `${label} ${blob}`;
    return { summary };
}
/**
 * Run the full PreToolUse gate against a parsed tool call.
 *
 * Side effects performed here (all crash-safe / never throw into the caller):
 *  - `POST /v1/guard/evaluate` (via `evaluateAction`).
 *  - resolve/mint the per-prompt grouping id (`resolvePromptGroup`).
 *  - on a step-up challenge: open the browser once per coordinate + write the
 *    latch. The stdout deny is emitted by the caller AFTER this returns, so a
 *    latch write cannot suppress the deny — and the latch write already swallows
 *    every error.
 */
export async function evaluatePreToolUse(input) {
    let classified;
    try {
        classified = classifyToolCall(input);
    }
    catch {
        // fail-open: classify must not brick the workflow.
        return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };
    }
    if (!classified)
        return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };
    const block = {
        reason: 'POST /guard/evaluate',
        command: classified.summary,
        toolName: wireToolName(input),
        ruleId: GUARD_EVALUATE_RULE_ID,
        stepupResource: DEFAULT_RBAC_RESOURCE,
        stepupAction: 'update',
    };
    if (!resolveToken().token) {
        return { kind: GATE_DECISION_KIND.BLOCK_NO_TOKEN, block };
    }
    const group = resolvePromptGroup();
    const sid = readSinglePendingLatchSid(group);
    // Guard v3: POST /guard/evaluate classifies + matrix + (level 2) step-up.
    let verdict = null;
    try {
        verdict = await evaluateAction(loadStepupConfig(), {
            payload: resolvePayload(input),
            toolName: wireToolName(input),
            cwd: input.cwd,
            provider: currentHostProvider(),
            group,
            sid,
        });
    }
    catch {
        verdict = null;
    }
    const permission = verdict?.permission ?? 2;
    const resource = verdict?.resource ?? block.stepupResource;
    const action = verdict?.action ?? block.stepupAction;
    const backendReasoning = verdict?.reasoning?.trim() || undefined;
    if (permission === 0) {
        // Hard RBAC deny — never a challenge, so any stale latch for this
        // coordinate is orphaned; clear it.
        clearLatch(group, resource, action);
        return {
            kind: GATE_DECISION_KIND.BLOCK_BY_POLICY,
            block,
            resource,
            action,
            reasoning: backendReasoning,
        };
    }
    if (permission === 1) {
        // Allowed — role permits outright, or step-up session already verified.
        clearLatch(group, resource, action);
        return {
            kind: GATE_DECISION_KIND.PROCEED_BY_POLICY,
            block,
            resource,
            action,
            reasoning: backendReasoning,
        };
    }
    // Level 2 — backend created or reused the step-up session.
    if (!verdict?.sid || !verdict.url) {
        return {
            kind: GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED,
            block,
            failure: { ok: false, reason: 'create-failed' },
            reasoning: backendReasoning,
        };
    }
    // ── Terminal: rejected — stop immediately (no poll loop, no retry nag) ───
    if (verdict.status === 'rejected') {
        clearLatch(group, resource, action);
        return {
            kind: GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED,
            block,
            resource,
            action,
            reasoning: backendReasoning,
        };
    }
    // ── Self-heal: stale latch when backend says NOT an in-flight pending ───
    //
    // pending + verified are "continue work" paths (poll or retry). Only drop a
    // latch when the backend is starting fresh (exist:false → session gone) so a
    // new browser tab can open.
    const reused = verdict.exist === true;
    const pending = verdict.status === 'pending' ||
        verdict.status === null ||
        verdict.status === undefined;
    if (hasLatch(group, resource, action) && !(reused && pending)) {
        clearLatch(group, resource, action);
    }
    // pending → open browser once, write latch, tell agent to poll.
    let browserLaunched = false;
    if (pending && !reused) {
        openBrowser(verdict.url);
        browserLaunched = true;
    }
    if (pending) {
        const prior = readLatchRecord(group, resource, action);
        writeLatch(group, resource, action, verdict.sid, prior?.createdAt ?? Date.now(), prior?.remindedCount);
    }
    return {
        kind: GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED,
        block,
        sid: verdict.sid,
        browserUrl: verdict.url,
        browserLaunched,
        resource,
        action,
        reasoning: backendReasoning,
    };
}
//# sourceMappingURL=evaluate.js.map