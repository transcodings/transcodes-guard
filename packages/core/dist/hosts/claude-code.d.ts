/**
 * Claude Code hook adapter (Codex delegates here; Cursor delegates parse only).
 *
 * PreToolUse stdin is mostly snake_case `tool_name` / `tool_input`. Cursor may
 * send a top-level `command` instead — we normalize locally; `rawPayload` is
 * forwarded verbatim to POST /guard/evaluate.
 */
import type { HookAdapter } from './types.js';
export declare const claudeCodeAdapter: HookAdapter;
