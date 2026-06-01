// ../../packages/hook-adapters/dist/claude-code.js
function readString(v) {
  return typeof v === "string" ? v : void 0;
}
var claudeCodeAdapter = {
  host: "claude-code",
  parsePreToolUseStdin(raw) {
    const payload = JSON.parse(raw);
    const toolName = readString(payload.tool_name);
    if (!toolName)
      throw new Error("PreToolUse payload missing tool_name");
    return {
      toolName,
      toolInput: payload.tool_input,
      cwd: readString(payload.cwd) ?? process.cwd(),
      sessionId: readString(payload.session_id),
      toolUseId: readString(payload.tool_use_id),
      hookEventName: readString(payload.hook_event_name)
    };
  },
  parseUserPromptSubmitStdin(raw) {
    const payload = JSON.parse(raw);
    return {
      prompt: readString(payload.prompt) ?? "",
      hookEventName: readString(payload.hook_event_name)
    };
  },
  emitPreToolUse(decision) {
    if (decision.kind === "allow") {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: decision.reason,
          ...decision.updatedInput !== void 0 ? { updatedInput: decision.updatedInput } : {}
        }
      });
    }
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason
      },
      ...decision.systemMessage !== void 0 ? { systemMessage: decision.systemMessage } : {}
    });
  },
  emitSessionStartContext(additionalContext) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext
      }
    });
  },
  emitUserPromptSubmitContext(additionalContext) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext
      }
    });
  },
  emitStop(reason) {
    return JSON.stringify({
      decision: "block",
      reason
    });
  }
};

// ../../packages/hook-adapters/dist/codex.js
var codexAdapter = {
  host: "codex",
  // Stdin field names match Claude Code's snake_case schema verbatim, so
  // the parse logic is identical. Delegating preserves a single source of
  // truth for stdin shape parsing.
  parsePreToolUseStdin(raw) {
    return claudeCodeAdapter.parsePreToolUseStdin(raw);
  },
  parseUserPromptSubmitStdin(raw) {
    return claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
  },
  emitPreToolUse(decision) {
    return claudeCodeAdapter.emitPreToolUse(decision);
  },
  emitSessionStartContext(additionalContext) {
    return claudeCodeAdapter.emitSessionStartContext(additionalContext);
  },
  emitUserPromptSubmitContext(additionalContext) {
    return claudeCodeAdapter.emitUserPromptSubmitContext(additionalContext);
  },
  emitStop(reason) {
    return claudeCodeAdapter.emitStop(reason);
  }
};

// ../../packages/hook-adapters/dist/antigravity.js
import { closeSync, openSync, readSync, statSync } from "fs";

export {
  codexAdapter
};
