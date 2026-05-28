#!/usr/bin/env node
/**
 * Antigravity 2.0 Stop hook — dangling step-up reminder + orphan reap.
 *
 * Same gate-logic flow as the Claude Code / Codex Stop hooks; the only
 * Antigravity-specific surface is the wire format. Antigravity's Stop hook
 * uses `{ decision: "continue", reason }` to prevent turn termination and
 * inject `reason` as a system message — the opposite verb from Claude
 * Code's `decision: "block"`, but the same UX intent. Whether `reason` is
 * actually surfaced to the model (vs silently dropped) is pending e2e
 * validation — see docs/research/antigravity-e2e-findings.md #4.
 */
import "../host.js";
