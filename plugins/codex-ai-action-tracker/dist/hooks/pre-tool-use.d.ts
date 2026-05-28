#!/usr/bin/env node
/**
 * Codex CLI PreToolUse hook — thin entrypoint over @ai-action-tracker/stepup-core.
 *
 * Mirrors plugins/claude-code-ai-action-tracker/hooks/pre-tool-use.ts; the
 * only divergence is the adapter (codexAdapter). Codex's wire format
 * converged on Claude Code's PreToolUse contract, so the bytes emitted
 * here are byte-for-byte identical — the adapter swap is structural, not
 * behavioural, and provides the seam for future host divergence (Cursor
 * camelCase, Antigravity wrap differences) without further code changes.
 */
import "../host.js";
