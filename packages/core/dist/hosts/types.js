/**
 * Host-agnostic hook contract types.
 *
 * Each host (Claude Code, Codex CLI, Cursor, Antigravity) feeds its hooks
 * via stdin JSON with subtly different field names and accepts stdout JSON
 * in subtly different shapes. The PreToolUse decision itself is universal
 * (allow/deny + reason + optional rewrite), so we model the *decision*
 * once here and let each host adapter render it into wire format.
 */
export {};
//# sourceMappingURL=types.js.map