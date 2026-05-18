#!/usr/bin/env node
/**
 * Claude Code Stop hook — catches a dangling step-up loop.
 *
 * If the agent finishes its turn while a pending step-up record is
 * still in flight, that almost always means the loop was forgotten
 * mid-protocol. This hook injects a reminder via `additionalContext`
 * so the next model request sees what remains to be done.
 *
 * Never blocks (no `decision: "block"`). Any error path is a no-op.
 */
export {};
