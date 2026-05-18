#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — protocol primer for the step-up loop.
 *
 * Injects an `additionalContext` block describing how the agent should
 * react when PreToolUse denies a Bash with "Step-up MFA pending". Without
 * this primer the agent must re-derive the protocol from each deny
 * message; with it, the agent has a stable reference frame for the
 * entire session.
 *
 * If a pending step-up record carries over from a previous session
 * (Claude was restarted mid-flow), include sid + browserUrl so the agent
 * can resume polling instead of starting over.
 *
 * Fail policy: this hook is purely additive context. Any error path
 * writes nothing and exits 0 — the session must never be blocked or
 * derailed by a primer.
 */
export {};
