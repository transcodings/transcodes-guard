/**
 * Claude Code hook adapter.
 *
 * Wire format mirrors what the existing plugins/claude-code-ai-action-tracker
 * hooks already emit (PreToolUse `hookSpecificOutput.permissionDecision`,
 * Stop top-level `decision: "block"`). See `.claude/rules/hooks.md` for the
 * per-event payload contract Claude Code's validator enforces.
 */
import type { HookAdapter } from "./types.js";
export declare const claudeCodeAdapter: HookAdapter;
