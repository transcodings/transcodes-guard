// ../../packages/hook-adapters/dist/antigravity.js
import { closeSync, openSync, readSync, statSync } from "fs";
var COMPLETION_PATTERN = /완료|성공|끝났|마쳤|됐어|통과|done|finished|verified|authenticated|authori[sz]ed|complete|passed|success/i;

// ../../packages/hook-adapters/dist/claude-code.js
function readString(v) {
  return typeof v === "string" ? v : void 0;
}
function parsePreToolUsePayload(raw) {
  try {
    const payload = JSON.parse(raw);
    const command = readString(payload.command);
    const filePath = readString(payload.file_path);
    const toolName = readString(payload.tool_name) ?? (command ? "Shell" : filePath ? "Read" : void 0) ?? "Unknown";
    const toolInput = payload.tool_input ?? payload.arguments ?? (command ? { command } : filePath ? { path: filePath } : payload);
    return {
      toolName,
      toolInput,
      rawPayload: payload,
      cwd: readString(payload.cwd) ?? process.cwd(),
      sessionId: readString(payload.session_id),
      toolUseId: readString(payload.tool_use_id),
      hookEventName: readString(payload.hook_event_name)
    };
  } catch {
    return {
      toolName: "Unknown",
      toolInput: { _raw: raw },
      rawPayload: { _raw: raw },
      cwd: process.cwd()
    };
  }
}
var claudeCodeAdapter = {
  host: "claude",
  parsePreToolUseStdin: parsePreToolUsePayload,
  parseUserPromptSubmitStdin(raw) {
    const payload = JSON.parse(raw);
    return {
      prompt: readString(payload.prompt) ?? "",
      hookEventName: readString(payload.hook_event_name)
    };
  },
  emitPreToolUse(decision) {
    const hookSpecificOutput = {
      hookEventName: "PreToolUse",
      permissionDecision: decision.kind === "allow" ? "allow" : "deny",
      permissionDecisionReason: decision.reason,
      ...decision.kind === "allow" && decision.updatedInput !== void 0 ? { updatedInput: decision.updatedInput } : {}
    };
    return JSON.stringify({
      hookSpecificOutput,
      ...decision.kind === "deny" && decision.systemMessage !== void 0 ? { systemMessage: decision.systemMessage } : {}
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
    return JSON.stringify({ decision: "block", reason });
  }
};

// ../../packages/hook-adapters/dist/cursor.js
var cursorAdapter = {
  host: "cursor",
  parsePreToolUseStdin(raw) {
    return claudeCodeAdapter.parsePreToolUseStdin(raw);
  },
  parseUserPromptSubmitStdin(raw) {
    return claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
  },
  emitPreToolUse(decision) {
    if (decision.kind === "allow") {
      return JSON.stringify({
        permission: "allow",
        ...decision.updatedInput !== void 0 ? { updated_input: decision.updatedInput } : {}
      });
    }
    return JSON.stringify({
      permission: "deny",
      user_message: decision.reason,
      agent_message: decision.systemMessage ?? decision.reason
    });
  },
  emitSessionStartContext(additionalContext) {
    return JSON.stringify({ additional_context: additionalContext });
  },
  emitUserPromptSubmitContext(_additionalContext) {
    throw new Error("Cursor's beforeSubmitPrompt has no additional_context channel. Perform consumeVerified/clearPending as side effects and emit `{ continue: true }` directly.");
  },
  emitStop(reason) {
    if (!reason)
      return "{}";
    return JSON.stringify({ followup_message: reason });
  }
};

export {
  COMPLETION_PATTERN,
  cursorAdapter
};
