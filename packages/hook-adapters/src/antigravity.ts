/**
 * Google Antigravity 2.0 hook adapter.
 *
 * Antigravity hooks use a native wire format inherited from Gemini CLI (per
 * antigravity.google/docs/gcli-migration), NOT the Claude Code wire format
 * that Codex converged on. So the bytes emitted here are NOT byte-for-byte
 * compatible with claudeCodeAdapter — this is an end-to-end native adapter,
 * not a delegation shim.
 *
 * Wire-format differences vs Claude Code (per antigravity.google/docs/hooks):
 *  - PreToolUse stdin: `toolCall.name` / `toolCall.args` / `stepIdx` /
 *    `conversationId` / `workspacePaths[]` / `transcriptPath` /
 *    `artifactDirectoryPath` (camelCase, nested toolCall). Claude Code uses
 *    flat `tool_name` / `tool_input` / `cwd` / `session_id` (snake_case).
 *  - PreToolUse stdout: top-level `{ decision: "allow"|"deny"|"ask"|
 *    "force_ask", reason?, permissionOverrides? }`. Claude Code wraps in
 *    `hookSpecificOutput.permissionDecision`.
 *  - Stop stdout: `{ decision: "continue", reason? }` where `"continue"`
 *    *prevents* turn termination and injects `reason` as a system message.
 *    Claude Code's Stop uses `{ decision: "block", reason }` which has
 *    similar UX intent but opposite verb. Antigravity's actual UX is
 *    pending e2e validation — see antigravity-e2e-findings.md #4.
 *  - No SessionStart / UserPromptSubmit hook events. PreInvocation (fires
 *    before every model call) takes both roles: `invocationNum===1` is the
 *    per-turn analogue of SessionStart, and tailing `transcriptPath` for
 *    user messages matching a completion pattern recovers the
 *    UserPromptSubmit detection.
 *
 * Tool-name normalization: Antigravity's shell tool is `run_command` (not
 * `Bash`), with args `CommandLine` / `Cwd` / `WaitMsBeforeAsync` instead of
 * `command` / `cwd`. The adapter rewrites `args.CommandLine -> args.command`
 * so `@transcodes-guard/stepup-core`'s `classifyToolCall` doesn't need
 * host branching beyond the additional toolName check it has for
 * `run_command`.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type {
  HookAdapter,
  InjectStep,
  PreInvocationInput,
  PreToolUseDecision,
  PreToolUseInput,
  UserPromptSubmitInput,
} from './types.js';

interface RawAntigravityPreToolUsePayload {
  toolCall?: {
    name?: unknown;
    args?: unknown;
  };
  stepIdx?: unknown;
  conversationId?: unknown;
  workspacePaths?: unknown;
  transcriptPath?: unknown;
  artifactDirectoryPath?: unknown;
}

interface RawAntigravityPreInvocationPayload {
  invocationNum?: unknown;
  initialNumSteps?: unknown;
  conversationId?: unknown;
  workspacePaths?: unknown;
  transcriptPath?: unknown;
  artifactDirectoryPath?: unknown;
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function readNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string') out.push(item);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Move `args.CommandLine` to `args.command` so the host-neutral classifier
 * in stepup-core finds the shell command without host branching. Other
 * `run_command` args (Cwd, WaitMsBeforeAsync, …) pass through unchanged.
 * Defensive: if `args.command` is already a string the input is returned
 * untouched (covers a future schema convergence with Claude Code/Codex).
 */
function normalizeToolInput(toolName: string, rawArgs: unknown): unknown {
  if (
    toolName !== 'run_command' ||
    rawArgs === null ||
    typeof rawArgs !== 'object'
  ) {
    return rawArgs;
  }
  const args = rawArgs as { command?: unknown; CommandLine?: unknown };
  if (typeof args.command === 'string') return rawArgs;
  if (typeof args.CommandLine !== 'string') return rawArgs;
  return {
    ...(rawArgs as Record<string, unknown>),
    command: args.CommandLine,
  };
}

/**
 * Tail the last `maxBytes` of a JSONL file and parse each line. Best-effort:
 * malformed lines and read errors are swallowed (returns empty array).
 * Used by the PreInvocation entry to inspect recent transcript messages
 * without loading the whole file.
 */
function tailJsonlLines(filePath: string, maxBytes = 32_768): unknown[] {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return [];
  }
  if (size === 0) return [];

  const readSize = Math.min(size, maxBytes);
  const buf = Buffer.alloc(readSize);

  try {
    const fd = openSync(filePath, 'r');
    try {
      readSync(fd, buf, 0, readSize, size - readSize);
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }

  const text = buf.toString('utf8');
  const lines = text.split('\n').filter((line) => line.length > 0);
  // If we started mid-line (size > readSize), drop the partial first line.
  if (size > readSize && lines.length > 1) lines.shift();

  const out: unknown[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // malformed line — ignore
    }
  }
  return out;
}

/**
 * The Korean+English keyword set the agent should recognize as "user
 * reports step-up done". Host-agnostic — shared by every host's
 * user-prompt hook (Claude Code / Codex UserPromptSubmit, Cursor
 * beforeSubmitPrompt) and the Antigravity transcript scan below.
 */
export const COMPLETION_PATTERN =
  /완료|성공|끝났|마쳤|됐어|통과|done|finished|verified|authenticated|authori[sz]ed|complete|passed|success/i;

/**
 * Inspect the tail of an Antigravity `transcript.jsonl` and return the
 * content of the most recent user-originated message if it matches the
 * completion pattern. Returns null if no recent user message matches or
 * if the file cannot be read.
 *
 * Antigravity's transcript line schema isn't fully spec'd, so this is
 * best-effort: accepts any object with a string `content` / `text` /
 * `message` field plus a role-like field equal to `"user"` /
 * `"user_message"`. Other shapes are skipped silently. If antigravity
 * changes the schema, the detection silently degrades to "no match"
 * rather than throwing.
 */
export function detectUserDoneFromTranscript(
  transcriptPath: string | undefined,
  pattern: RegExp = COMPLETION_PATTERN,
): string | null {
  if (!transcriptPath) return null;

  const entries = tailJsonlLines(transcriptPath);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as {
      role?: unknown;
      type?: unknown;
      content?: unknown;
      text?: unknown;
      message?: unknown;
    };
    const role = readString(e.role) ?? readString(e.type);
    if (role !== 'user' && role !== 'user_message') continue;
    const content =
      readString(e.content) ?? readString(e.text) ?? readString(e.message);
    if (!content) continue;
    // Found the most recent user message; only this one is relevant.
    // Older user messages would have been processed by earlier
    // PreInvocation calls.
    return pattern.test(content) ? content : null;
  }
  return null;
}

export const antigravityAdapter: HookAdapter = {
  host: 'antigravity',

  parsePreToolUseStdin(raw: string): PreToolUseInput {
    const payload = JSON.parse(raw) as RawAntigravityPreToolUsePayload;
    const toolCall = payload.toolCall;
    const toolName = readString(toolCall?.name);
    if (!toolName) {
      throw new Error('PreToolUse payload missing toolCall.name');
    }
    const workspacePaths = readStringArray(payload.workspacePaths);
    return {
      toolName,
      toolInput: normalizeToolInput(toolName, toolCall?.args),
      cwd: workspacePaths?.[0] ?? process.cwd(),
      sessionId: readString(payload.conversationId),
      hookEventName: 'PreToolUse',
    };
  },

  parseUserPromptSubmitStdin(_raw: string): UserPromptSubmitInput {
    // Antigravity has no UserPromptSubmit hook event. Plugin code that
    // needs user-prompt awareness should use parsePreInvocationStdin +
    // detectUserDoneFromTranscript() instead. This stub exists only to
    // satisfy the HookAdapter contract; reaching it indicates a wiring
    // bug in the calling hook entry script.
    throw new Error(
      'Antigravity has no UserPromptSubmit hook event. Use PreInvocation + detectUserDoneFromTranscript().',
    );
  },

  parsePreInvocationStdin(raw: string): PreInvocationInput {
    const payload = JSON.parse(raw) as RawAntigravityPreInvocationPayload;
    return {
      invocationNum: readNumber(payload.invocationNum) ?? 0,
      initialNumSteps: readNumber(payload.initialNumSteps) ?? 0,
      conversationId: readString(payload.conversationId),
      transcriptPath: readString(payload.transcriptPath),
      workspacePaths: readStringArray(payload.workspacePaths),
      artifactDirectoryPath: readString(payload.artifactDirectoryPath),
    };
  },

  emitPreToolUse(decision: PreToolUseDecision): string {
    if (decision.kind === 'allow') {
      // updatedInput from the host-neutral decision isn't directly
      // supported by antigravity's PreToolUse output schema (it has
      // permissionOverrides for scoped permits, not arbitrary arg
      // rewrite). If we ever need rewrite, emit it as a PostInvocation
      // injectSteps toolCall instead.
      return JSON.stringify({
        decision: 'allow',
        reason: decision.reason,
      });
    }
    // Antigravity has no separate `systemMessage` channel — `reason` is
    // the single text surface shown to both the agent and (when
    // applicable) the user. Prefer the longer `systemMessage` if the
    // gate populated one; otherwise fall back to the short `reason`.
    return JSON.stringify({
      decision: 'deny',
      reason: decision.systemMessage ?? decision.reason,
    });
  },

  emitSessionStartContext(_additionalContext: string): string {
    // Antigravity has no SessionStart hook event. The "carry-over" notice
    // path is folded into PreInvocation (invocationNum=1). Reaching this
    // stub indicates a wiring bug in the calling hook entry script.
    throw new Error(
      'Antigravity has no SessionStart hook event. Use PreInvocation with invocationNum=1.',
    );
  },

  emitUserPromptSubmitContext(_additionalContext: string): string {
    // Antigravity has no UserPromptSubmit hook event. See parseUserPromptSubmitStdin.
    throw new Error(
      'Antigravity has no UserPromptSubmit hook event. Use PreInvocation + detectUserDoneFromTranscript().',
    );
  },

  emitPreInvocation(injectSteps: InjectStep[]): string {
    if (injectSteps.length === 0) return '{}';
    return JSON.stringify({ injectSteps });
  },

  emitStop(reason: string): string {
    // Antigravity's Stop hook treats `decision: "continue"` as "do NOT
    // stop — re-enter the execution loop and inject `reason` as a system
    // message". This matches the UX intent of Claude Code's Stop reminder
    // (force the model to keep working until step-up clears) even though
    // the verb is inverted. If e2e finds the UX is poor (e.g. reason
    // isn't visible to the model), switch to silent reap by returning
    // "{}" unconditionally. Tracked in antigravity-e2e-findings.md #4.
    if (!reason) return '{}';
    return JSON.stringify({ decision: 'continue', reason });
  },
};
