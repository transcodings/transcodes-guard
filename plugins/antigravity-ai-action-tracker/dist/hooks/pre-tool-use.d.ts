#!/usr/bin/env node
/**
 * Antigravity 2.0 PreToolUse hook — thin entrypoint over @ai-action-tracker/stepup-core.
 *
 * Unlike the Codex entry (which delegates to claudeCodeAdapter), this one
 * uses antigravityAdapter — a fully native wire-format adapter. The bytes
 * emitted from here are NOT compatible with Claude Code's hook validator:
 * stdin is `toolCall.name/args` (camelCase, nested), stdout is top-level
 * `{ decision, reason }` instead of `hookSpecificOutput.permissionDecision`.
 * See packages/hook-adapters/src/antigravity.ts for the schema rationale.
 *
 * Tool matcher: `run_command` only (1차 출시 scope). Antigravity's file-edit
 * tools (`write_to_file`, `replace_file_content`, …) and MCP tool calls are
 * intentionally not gated — see the plugin README for the scope rationale.
 */
import "../host.js";
