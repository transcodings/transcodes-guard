#!/usr/bin/env node
/**
 * Codex CLI SessionStart hook — pending carry-over notice only.
 *
 * The static protocol primer lives in AGENTS.md (Codex auto-loads it into
 * every turn's system message), so this hook focuses on the dynamic part:
 * if a step-up session carried over from the previous session, surface its
 * sid + status so the agent can resume polling instead of starting over.
 * Pure additive context — never blocks.
 */
import "../host.js";
