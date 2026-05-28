#!/usr/bin/env node
/**
 * Claude Code Stop hook — catches a dangling step-up loop + reaps orphans.
 *
 * Orphan cleanup rules (silent — no reminder JSON):
 *   - verified record exists + pending gone or status != "pending"
 *   - pending says "verified" + verified file gone
 *
 * Otherwise, if a real pending record is in flight, emit a top-level
 * `{ decision: "block", reason }` reminder. Stop is excluded from the
 * `hookSpecificOutput` enum — wrapping it makes the validator reject.
 */
import "../host.js";
