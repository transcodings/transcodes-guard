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

// ../../packages/hook-adapters/dist/antigravity.js
import { closeSync, openSync, readSync, statSync } from "fs";

export {
  claudeCodeAdapter
};
