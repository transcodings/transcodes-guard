#!/usr/bin/env node
/**
 * Codex CLI Stop hook — dangling step-up reminder + orphan reap.
 *
 * Identical behaviour to the Claude Code variant; differs only in the
 * adapter import. Codex accepts the same top-level `{ decision: "block",
 * reason }` payload as Claude Code for Stop hooks.
 */
import "../host.js";
