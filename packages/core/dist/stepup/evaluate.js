/**
 * Host-agnostic PreToolUse gate decision (Guard v3, backend-as-SSOT).
 *
 * Every host's hook entrypoint is a thin shell: parse stdin → call
 * `evaluatePreToolUse` → emit via that host's adapter. The same decision shape
 * drives Claude Code, Codex, Cursor, and Antigravity.
 *
 * Guard v3: every host tool call (except built-in transcodes-guard MCP and host
 * meta-tool bypass sets below) → `POST /guard/evaluate` with the raw hook stdin
 * JSON as `payload`. Backend reuses MFA via Redis
 * `stepup:{projectId}:{memberId}:{resource}:{action}`. Client opens the browser
 * only when `exist:false` (fresh mint); no local latch / prompt group.
 *
 * Fail policy:
 *  - Before classify (stdin parse) → `proceed-ungated` (fail-open); the caller
 *    exits 0 with no JSON.
 *  - After classify, no token → `block-no-token` (fail-closed).
 *  - After classify, backend unreachable / unparseable → permission 2
 *    (step-up); a failed evaluate without a session becomes
 *    `block-stepup-create-failed`, carrying the HTTP status / backend error
 *    text in `failure.detail` so the deny is diagnosable (issue #189).
 */
import { currentHostProvider, DEFAULT_RBAC_RESOURCE, isTranscodesGuardWireToolName, } from '../patterns/index.js';
import { loadStepupConfig } from './config.js';
import { openBrowser } from './gate.js';
import { evaluateAction } from './rbac-check.js';
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
 *  - on a fresh step-up challenge (`exist:false`): open the browser once.
 *    Concurrent hooks rely on backend coordinate claim (SET NX) for dedupe —
 *    no local latch / prompt group.
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
    // Guard v3: POST /guard/evaluate classifies + matrix + (level 2) step-up.
    // On failure `verdict` stays null (fail-closed → permission 2) and
    // `failureDetail` records WHY, so the deny message is diagnosable (#189).
    // Reason vocabulary matches console.ts: backend-side failure (refusal,
    // unreachable, malformed) → 'create-failed' (decision-audited), local
    // client throw → 'error' (excluded from the decision audit).
    let verdict = null;
    let failureDetail;
    let failureReason = 'create-failed';
    try {
        const result = await evaluateAction(loadStepupConfig(), {
            payload: resolvePayload(input),
            toolName: wireToolName(input),
            cwd: input.cwd,
            provider: currentHostProvider(),
        });
        if (result.ok) {
            verdict = result.verdict;
        }
        else {
            failureDetail =
                result.kind === 'network'
                    ? `backend unreachable${result.message ? `: ${result.message}` : ' (network/timeout)'}`
                    : result.kind === 'http'
                        ? `backend evaluate failed: HTTP ${result.status}${result.message ? ` — ${result.message}` : ''}`
                        : 'malformed backend response';
        }
    }
    catch (err) {
        verdict = null;
        failureReason = 'error';
        failureDetail = `unexpected client error: ${err instanceof Error ? err.message : String(err)}`;
    }
    const permission = verdict?.permission ?? 2;
    const resource = verdict?.resource ?? block.stepupResource;
    const action = verdict?.action ?? block.stepupAction;
    const backendReasoning = verdict?.reasoning?.trim() || undefined;
    if (permission === 0) {
        return {
            kind: GATE_DECISION_KIND.BLOCK_BY_POLICY,
            block,
            resource,
            action,
            reasoning: backendReasoning,
        };
    }
    if (permission === 1) {
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
            failure: {
                ok: false,
                reason: failureReason,
                detail: failureDetail ??
                    'backend returned permission=2 without a session (sid/url missing)',
            },
            reasoning: backendReasoning,
        };
    }
    // Reject normally wipes Redis; keep this terminal skip path as a safety.
    if (verdict.status === 'rejected') {
        return {
            kind: GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED,
            block,
            resource,
            action,
            reasoning: backendReasoning,
        };
    }
    const reused = verdict.exist === true;
    const pending = verdict.status === 'pending' ||
        verdict.status === null ||
        verdict.status === undefined;
    // pending + exist:false → open browser once (backend SET NX owns dedupe).
    let browserLaunched = false;
    if (pending && !reused) {
        openBrowser(verdict.url);
        browserLaunched = true;
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