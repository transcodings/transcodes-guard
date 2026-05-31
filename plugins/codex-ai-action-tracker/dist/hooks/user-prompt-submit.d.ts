#!/usr/bin/env node
/**
 * Codex CLI UserPromptSubmit hook — same logic as the Claude Code variant.
 *
 * Detects user prompts that signal step-up completion and injects a sid +
 * next-action context block. Identical body to the Claude Code hook except
 * for the adapter import.
 */
import "../host.js";
