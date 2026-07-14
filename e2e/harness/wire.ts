/**
 * Per-host wire-format builders + assertions — the e2e harness's single
 * mirror of `.claude/rules/mcp-and-hosts.md`.
 *
 * stdin shapes:
 *  - claude-code / codex / cursor: flat snake_case `{tool_name, tool_input,
 *    cwd, …}` (codex and cursor delegate stdin parsing to the Claude Code
 *    adapter; cursor's divergence is output-only).
 *  - antigravity: camelCase nested `{toolCall:{name,args}, workspacePaths:[…]}`;
 *    shell tool is `run_command` with `args.CommandLine`; lazy MCP calls ride
 *    a `call_mcp_tool` wrapper with the real name in `args.ToolName`.
 *
 * stdout deny shapes:
 *  - claude-code / codex: `{hookSpecificOutput:{hookEventName:'PreToolUse',
 *    permissionDecision:'deny', permissionDecisionReason}, systemMessage?}`.
 *    Codex additionally requires a NON-EMPTY reason (empty → parser rejects →
 *    fail-open), asserted for every host since the shape is shared.
 *  - cursor: flat `{permission:'deny', user_message, agent_message}`.
 *  - antigravity: `{decision:'deny', reason}`.
 *
 * Passes: claude-code/codex/antigravity exit 0 with NO output on PROCEED_*.
 * Cursor is the exception — its hooks run `failClosed:true`, where no output
 * counts as hook failure (= closed), so the cursor entry always emits an
 * explicit flat `{"permission":"allow"}` on a pass. Stop no-ops are "no
 * output" on every host (v3 Stop hooks are pure no-ops).
 *
 * Fixture warning: the built-in skip predicate matches SUBSTRINGS
 * (`tc_` / `transcodes` / `version`, prefix `mcp_plugin_transcodes_guard`) —
 * gated-path fixture tool names must avoid those substrings.
 */
import assert from 'node:assert/strict';
import type { HookRunResult, HostId } from './hook-runner.js';

export { ALL_HOSTS, type HostId } from './hook-runner.js';

export type DenyShape = { reason: string; systemText?: string };

export type WireSpec = {
  host: HostId;
  /** Shell wire tool name (`Bash` / `Bash` / `Shell` / `run_command`). */
  shellToolName: string;
  /** Backend provider slug sent in the evaluate body (`claude`, not `claude-code`). */
  providerSlug: string;
  shellStdin(command: string, cwd: string): string;
  mcpStdin(toolName: string, args: unknown, cwd: string): string;
  assertDeny(res: HookRunResult): DenyShape;
  assertPass(res: HookRunResult): void;
  assertStopNoop(res: HookRunResult): void;
  /** Wrapper leaks that must never appear in this host's stdout. */
  forbiddenSubstrings: string[];
};

function raw(res: HookRunResult): string {
  return `\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`;
}

function assertNoOutput(res: HookRunResult): void {
  assert.equal(res.exitCode, 0, `expected exit 0${raw(res)}`);
  assert.equal(res.stdout, '', `expected empty stdout${raw(res)}`);
}

function assertForbidden(res: HookRunResult, substrings: string[]): void {
  for (const s of substrings) {
    assert.ok(!res.stdout.includes(s), `stdout must not contain "${s}"${raw(res)}`);
  }
}

function claudeStyleDeny(res: HookRunResult, forbidden: string[]): DenyShape {
  assert.equal(res.exitCode, 0, `deny must exit 0 (never exit 2)${raw(res)}`);
  assertForbidden(res, forbidden);
  const out = res.json() as {
    hookSpecificOutput?: {
      hookEventName?: string;
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
    systemMessage?: string;
  };
  const hso = out.hookSpecificOutput;
  assert.ok(hso, `deny must carry hookSpecificOutput${raw(res)}`);
  assert.equal(hso.hookEventName, 'PreToolUse', raw(res));
  assert.equal(hso.permissionDecision, 'deny', raw(res));
  assert.ok(
    typeof hso.permissionDecisionReason === 'string' && hso.permissionDecisionReason.length > 0,
    `permissionDecisionReason must be a non-empty string (Codex rejects empty → fail-open)${raw(res)}`,
  );
  return { reason: hso.permissionDecisionReason, systemText: out.systemMessage };
}

function snakeCaseStdin(toolName: string, toolInput: unknown, cwd: string): string {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: toolInput,
    cwd,
    session_id: 'e2e-session',
    hook_event_name: 'PreToolUse',
  });
}

function antigravityStdin(name: string, args: unknown, cwd: string): string {
  return JSON.stringify({
    toolCall: { name, args },
    stepIdx: 1,
    conversationId: 'e2e-conversation',
    workspacePaths: [cwd],
  });
}

/** Antigravity's lazy-MCP dispatch wrapper — real name in `args.ToolName`. */
export function antigravityCallMcpStdin(toolName: string, args: unknown, cwd: string): string {
  return antigravityStdin('call_mcp_tool', { ToolName: toolName, ToolArgs: args }, cwd);
}

const claudeCode: WireSpec = {
  host: 'claude-code',
  shellToolName: 'Bash',
  providerSlug: 'claude',
  shellStdin: (command, cwd) => snakeCaseStdin('Bash', { command }, cwd),
  mcpStdin: (toolName, args, cwd) => snakeCaseStdin(toolName, args, cwd),
  assertDeny: (res) => claudeStyleDeny(res, claudeCodeForbidden),
  assertPass: assertNoOutput,
  assertStopNoop: assertNoOutput,
  forbiddenSubstrings: [],
};
const claudeCodeForbidden: string[] = [];

const codex: WireSpec = {
  ...claudeCode,
  host: 'codex',
  providerSlug: 'codex',
};

const cursorForbidden = ['hookSpecificOutput', 'permissionDecision'];
const cursor: WireSpec = {
  host: 'cursor',
  shellToolName: 'Shell',
  providerSlug: 'cursor',
  shellStdin: (command, cwd) => snakeCaseStdin('Shell', { command }, cwd),
  mcpStdin: (toolName, args, cwd) => snakeCaseStdin(toolName, args, cwd),
  assertDeny(res: HookRunResult): DenyShape {
    assert.equal(res.exitCode, 0, `deny must exit 0${raw(res)}`);
    assertForbidden(res, cursorForbidden);
    const out = res.json() as {
      permission?: string;
      user_message?: string;
      agent_message?: string;
    };
    assert.equal(out.permission, 'deny', raw(res));
    assert.ok(
      typeof out.user_message === 'string' && out.user_message.length > 0,
      `cursor deny must carry a non-empty user_message${raw(res)}`,
    );
    return { reason: out.user_message, systemText: out.agent_message };
  },
  assertPass(res: HookRunResult): void {
    // failClosed:true — a silent pass would read as hook failure (= closed),
    // so the cursor entry emits an explicit flat allow on every PROCEED_*.
    assert.equal(res.exitCode, 0, `expected exit 0${raw(res)}`);
    assertForbidden(res, cursorForbidden);
    const out = res.json() as { permission?: string };
    assert.equal(out.permission, 'allow', raw(res));
  },
  assertStopNoop: assertNoOutput,
  forbiddenSubstrings: cursorForbidden,
};

const antigravityForbidden = ['hookSpecificOutput', 'permissionDecision'];
const antigravity: WireSpec = {
  host: 'antigravity',
  shellToolName: 'run_command',
  providerSlug: 'antigravity',
  shellStdin: (command, cwd) => antigravityStdin('run_command', { CommandLine: command, Cwd: cwd }, cwd),
  mcpStdin: (toolName, args, cwd) => antigravityStdin(toolName, args, cwd),
  assertDeny(res: HookRunResult): DenyShape {
    assert.equal(res.exitCode, 0, `deny must exit 0${raw(res)}`);
    assertForbidden(res, antigravityForbidden);
    const out = res.json() as { decision?: string; reason?: string };
    assert.equal(out.decision, 'deny', raw(res));
    assert.ok(
      typeof out.reason === 'string' && out.reason.length > 0,
      `antigravity deny must carry a non-empty reason${raw(res)}`,
    );
    return { reason: out.reason };
  },
  assertPass: assertNoOutput,
  assertStopNoop: assertNoOutput,
  forbiddenSubstrings: antigravityForbidden,
};

export const wire: Record<HostId, WireSpec> = {
  'claude-code': claudeCode,
  codex,
  cursor,
  antigravity,
};
