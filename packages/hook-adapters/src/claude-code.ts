/**
 * Claude Code hook adapter.
 *
 * Wire format mirrors what the existing plugins/claude-code-ai-action-tracker
 * hooks already emit (PreToolUse `hookSpecificOutput.permissionDecision`,
 * Stop top-level `decision: "block"`). See `.claude/rules/hooks.md` for the
 * per-event payload contract Claude Code's validator enforces.
 *
 * Host identification (AI_ACTION_TRACKER_HOST env var) is claimed by each
 * plugin's `host.ts` side-effect file, NOT here — the hook-adapters barrel
 * re-exports all four adapters, so setting env in the adapter would cause
 * whichever loads last to overwrite the previous claim.
 */

import type {
  HookAdapter,
  PreToolUseDecision,
  PreToolUseInput,
  UserPromptSubmitInput,
} from "./types.js";

interface RawPreToolUsePayload {
  tool_name?: unknown;
  tool_input?: unknown;
  cwd?: unknown;
  session_id?: unknown;
  tool_use_id?: unknown;
  hook_event_name?: unknown;
}

interface RawUserPromptSubmitPayload {
  prompt?: unknown;
  hook_event_name?: unknown;
}

function readString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export const claudeCodeAdapter: HookAdapter = {
  host: "claude-code",

  parsePreToolUseStdin(raw: string): PreToolUseInput {
    const payload = JSON.parse(raw) as RawPreToolUsePayload;
    const toolName = readString(payload.tool_name);
    if (!toolName) throw new Error("PreToolUse payload missing tool_name");
    return {
      toolName,
      toolInput: payload.tool_input,
      cwd: readString(payload.cwd) ?? process.cwd(),
      sessionId: readString(payload.session_id),
      toolUseId: readString(payload.tool_use_id),
      hookEventName: readString(payload.hook_event_name),
    };
  },

  parseUserPromptSubmitStdin(raw: string): UserPromptSubmitInput {
    const payload = JSON.parse(raw) as RawUserPromptSubmitPayload;
    return {
      prompt: readString(payload.prompt) ?? "",
      hookEventName: readString(payload.hook_event_name),
    };
  },

  emitPreToolUse(decision: PreToolUseDecision): string {
    if (decision.kind === "allow") {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: decision.reason,
          ...(decision.updatedInput !== undefined
            ? { updatedInput: decision.updatedInput }
            : {}),
        },
      });
    }
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason,
      },
      ...(decision.systemMessage !== undefined
        ? { systemMessage: decision.systemMessage }
        : {}),
    });
  },

  emitSessionStartContext(additionalContext: string): string {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
    });
  },

  emitUserPromptSubmitContext(additionalContext: string): string {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext,
      },
    });
  },

  emitStop(reason: string): string {
    // Top-level decision: Stop is excluded from the hookSpecificOutput enum
    // in Claude Code's validator, so wrapping rejects the payload.
    return JSON.stringify({
      decision: "block",
      reason,
    });
  },
};
