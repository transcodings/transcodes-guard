#!/usr/bin/env node
/**
 * Cursor stop hook — dangling step-up reminder + orphan reap.
 *
 * Cursor's stop output is `{ followup_message? }` — semantically identical
 * to Claude Code's `{ decision: "block", reason }` (instructs the model on
 * the next turn) but uses a different key name. The cursorAdapter handles
 * the rendering; the rest of the body mirrors the codex stop entry.
 */
import "../host.js";
