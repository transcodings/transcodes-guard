#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — protocol primer + carry-over notice.
 *
 * Injects an `additionalContext` block describing how the agent should react
 * to PreToolUse step-up denies, plus a pointer to any session-spanning
 * pending sid that survived a restart. Pure additive context — never blocks.
 */
import "../host.js";
