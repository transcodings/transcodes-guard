/**
 * Cursor IDE hook adapter.
 *
 * Cursor uses a native wire format documented at cursor.com/docs/agent/hooks
 * (verified 2026-05-27). Key divergences vs Claude Code:
 *
 *  - stdin: snake_case `tool_name` / `tool_input` / `cwd` / `conversation_id`
 *    — same shape as Claude Code, so parse logic delegates to claudeCodeAdapter.
 *  - PreToolUse stdout: FLAT `{ permission, user_message?, agent_message?, updated_input? }`
 *    — no `hookSpecificOutput` wrapper, no `permissionDecisionReason`.
 *    `user_message` is shown as a UI toast, `agent_message` is fed back into
 *    the model's context; our reason/systemMessage split maps naturally.
 *  - beforeShellExecution / beforeMCPExecution: same flat shape but also
 *    accepts `permission: "ask"`. We emit `allow`/`deny` only.
 *  - SessionStart stdout: `{ additional_context?, env? }` (snake_case).
 *  - UserPromptSubmit equivalent (`beforeSubmitPrompt`): has NO context
 *    injection channel — only `{ continue, user_message? }`. The
 *    `emitUserPromptSubmitContext` method below throws to surface wiring
 *    bugs; the matching hook entry handles user "auth done" prompts via
 *    side effects only (consumeVerified + clearPending).
 *  - Stop stdout: `{ followup_message? }` — Claude Code's `{ decision: "block",
 *    reason }` semantic, different key name.
 *
 * We use `beforeShellExecution` + `beforeMCPExecution` (event-specific
 * variants) instead of the generic `preToolUse`. They share the same
 * snake_case stdin shape so a single `pre-tool-use.ts` entry handles both.
 */
import { claudeCodeAdapter } from "./claude-code.js";
import type {
  HookAdapter,
  PreToolUseDecision,
  PreToolUseInput,
  UserPromptSubmitInput,
} from "./types.js";

export const cursorAdapter: HookAdapter = {
  host: "cursor",

  parsePreToolUseStdin(raw: string): PreToolUseInput {
    return claudeCodeAdapter.parsePreToolUseStdin(raw);
  },

  parseUserPromptSubmitStdin(raw: string): UserPromptSubmitInput {
    return claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
  },

  emitPreToolUse(decision: PreToolUseDecision): string {
    if (decision.kind === "allow") {
      return JSON.stringify({
        permission: "allow",
        ...(decision.updatedInput !== undefined
          ? { updated_input: decision.updatedInput }
          : {}),
      });
    }
    return JSON.stringify({
      permission: "deny",
      user_message: decision.reason,
      agent_message: decision.systemMessage ?? decision.reason,
    });
  },

  emitSessionStartContext(additionalContext: string): string {
    return JSON.stringify({ additional_context: additionalContext });
  },

  emitUserPromptSubmitContext(_additionalContext: string): string {
    // Cursor's beforeSubmitPrompt has no additional_context channel — its
    // only outputs are `continue` (allow/block submission) and a
    // user-facing toast. The hook entry should perform consume/clear side
    // effects directly and emit `{ continue: true }`. Reaching this stub
    // indicates the entry script wrongly routed an additionalContext path.
    throw new Error(
      "Cursor's beforeSubmitPrompt has no additional_context channel. " +
        "Perform consumeVerified/clearPending as side effects and emit `{ continue: true }` directly.",
    );
  },

  emitStop(reason: string): string {
    if (!reason) return "{}";
    return JSON.stringify({ followup_message: reason });
  },
};
