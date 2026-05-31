// ../../packages/hook-adapters/dist/antigravity.js
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
function tailJsonlLines(filePath, maxBytes = 32768) {
  let size;
  try {
    size = statSync(filePath).size;
  } catch {
    return [];
  }
  if (size === 0)
    return [];
  const readSize = Math.min(size, maxBytes);
  const buf = Buffer.alloc(readSize);
  try {
    const fd = openSync(filePath, "r");
    try {
      readSync(fd, buf, 0, readSize, size - readSize);
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
  const text = buf.toString("utf8");
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (size > readSize && lines.length > 1)
    lines.shift();
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
    }
  }
  return out;
}
var ANTIGRAVITY_COMPLETION_PATTERN = /완료|성공|끝났|마쳤|됐어|통과|done|finished|verified|authenticated|authori[sz]ed|complete|passed|success/i;
function detectUserDoneFromTranscript(transcriptPath, pattern = ANTIGRAVITY_COMPLETION_PATTERN) {
  if (!transcriptPath)
    return null;
  const entries = tailJsonlLines(transcriptPath);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === null || typeof entry !== "object")
      continue;
    const e = entry;
    const role = readString(e.role) ?? readString(e.type);
    if (role !== "user" && role !== "user_message")
      continue;
    const content = readString(e.content) ?? readString(e.text) ?? readString(e.message);
    if (!content)
      continue;
    return pattern.test(content) ? content : null;
  }
  return null;
}
var antigravityAdapter = {
  host: "antigravity",
  parsePreToolUseStdin(raw) {
    const payload = JSON.parse(raw);
    const toolCall = payload.toolCall;
    const toolName = readString(toolCall?.name);
    if (!toolName) {
      throw new Error("PreToolUse payload missing toolCall.name");
    }
    const workspacePaths = readStringArray(payload.workspacePaths);
    return {
      toolName,
      toolInput: normalizeToolInput(toolName, toolCall?.args),
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
  detectUserDoneFromTranscript,
  antigravityAdapter
};
