// ../../packages/core/dist/hosts/antigravity.js
import { closeSync, openSync, readSync, statSync } from "fs";
function readString(v) {
  return typeof v === "string" ? v : void 0;
}
function readNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function readStringArray(v) {
  if (!Array.isArray(v))
    return void 0;
  const out = [];
  for (const item of v) {
    if (typeof item === "string")
      out.push(item);
  }
  return out.length > 0 ? out : void 0;
}
function normalizeToolInput(toolName, rawArgs) {
  if (toolName !== "run_command" || rawArgs === null || typeof rawArgs !== "object") {
    return rawArgs;
  }
  const args = rawArgs;
  if (typeof args.command === "string")
    return rawArgs;
  if (typeof args.CommandLine !== "string")
    return rawArgs;
  return {
    ...rawArgs,
    command: args.CommandLine
  };
}
function unwrapMcpDispatch(name, rawArgs) {
  if (name !== "call_mcp_tool" || rawArgs === null || typeof rawArgs !== "object") {
    return { toolName: name, toolArgs: rawArgs };
  }
  const a = rawArgs;
  const inner = readString(a.ToolName) ?? readString(a.toolName);
  if (!inner)
    return { toolName: name, toolArgs: rawArgs };
  const innerArgs = a.ToolArgs ?? a.toolArgs ?? a.Args ?? a.Arguments ?? a.ToolInput;
  return {
    toolName: inner,
    toolArgs: innerArgs !== null && typeof innerArgs === "object" ? innerArgs : rawArgs
  };
}
var antigravityAdapter = {
  host: "antigravity",
  parsePreToolUseStdin(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return {
        toolName: "Unknown",
        toolInput: { _raw: raw },
        rawPayload: { _raw: raw },
        cwd: process.cwd()
      };
    }
    const toolCall = payload.toolCall;
    const { toolName, toolArgs } = unwrapMcpDispatch(readString(toolCall?.name), toolCall?.args);
    const workspacePaths = readStringArray(payload.workspacePaths);
    return {
      toolName: toolName ?? "Unknown",
      toolInput: toolName ? normalizeToolInput(toolName, toolArgs) : payload,
      rawPayload: payload,
      cwd: workspacePaths?.[0] ?? process.cwd(),
      sessionId: readString(payload.conversationId),
      hookEventName: "PreToolUse"
    };
  },
  parseUserPromptSubmitStdin(_raw) {
    throw new Error("Antigravity has no UserPromptSubmit hook event. Use PreInvocation + detectUserDoneFromTranscript().");
  },
  parsePreInvocationStdin(raw) {
    const payload = JSON.parse(raw);
    return {
      invocationNum: readNumber(payload.invocationNum) ?? 0,
      initialNumSteps: readNumber(payload.initialNumSteps) ?? 0,
      conversationId: readString(payload.conversationId),
      transcriptPath: readString(payload.transcriptPath),
      workspacePaths: readStringArray(payload.workspacePaths),
      artifactDirectoryPath: readString(payload.artifactDirectoryPath)
    };
  },
  emitPreToolUse(decision) {
    if (decision.kind === "allow") {
      return JSON.stringify({
        decision: "allow",
        reason: decision.reason
      });
    }
    return JSON.stringify({
      decision: "deny",
      reason: decision.systemMessage ?? decision.reason
    });
  },
  emitSessionStartContext(_additionalContext) {
    throw new Error("Antigravity has no SessionStart hook event. Use PreInvocation with invocationNum=1.");
  },
  emitUserPromptSubmitContext(_additionalContext) {
    throw new Error("Antigravity has no UserPromptSubmit hook event. Use PreInvocation + detectUserDoneFromTranscript().");
  },
  emitPreInvocation(injectSteps) {
    if (injectSteps.length === 0)
      return "{}";
    return JSON.stringify({ injectSteps });
  },
  emitStop(reason) {
    if (!reason)
      return "{}";
    return JSON.stringify({ decision: "continue", reason });
  }
};

export {
  antigravityAdapter
};
