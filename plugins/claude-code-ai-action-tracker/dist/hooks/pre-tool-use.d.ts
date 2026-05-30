#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook — thin entrypoint over @ai-action-tracker/stepup-core.
 *
 * All real logic (regex match, git ls-files semantic check, MCP tool-rule
 * lookup, fast-path verified consume, step-up MFA session creation) lives in
 * `evaluatePreToolUse` in stepup-core. This file:
 *   1. Parses stdin via the Claude Code adapter.
 *   2. Calls evaluatePreToolUse to produce a host-agnostic GateDecision.
 *   3. Renders the decision into Claude Code wire format via the adapter +
 *      message formatters.
 *   4. Performs the post-emit side effects in the right order (writePending
 *      AFTER stdout emit so a throw cannot suppress the deny — see
 *      `.claude/rules/hooks.md` "Order is load-bearing").
 *
 * Fail-open before any danger match, fail-safe after — same asymmetric policy
 * as the original 500-line file, now expressed in ~80 lines.
 */
import "../host.js";
