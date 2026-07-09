/**
 * OpenAI Codex CLI hook adapter.
 *
 * Codex's deny/context/Stop wire shapes match Claude Code's, so those methods
 * delegate. But Codex's PreToolUse parser is NOT byte-identical to Claude
 * Code's on the `allow` path — verified against openai/codex `main`
 * (`codex-rs/hooks/src/schema.rs`, `engine/output_parser.rs`, last modified
 * 2026-05-28, v0.143 line):
 *  - **`permissionDecision:"allow"` is UNSUPPORTED without `updatedInput`.** A
 *    bare allow fills an `invalid_reason` ("unsupported permissionDecision:allow")
 *    → the hook run is marked Failed → the tool call proceeds on the host's
 *    default flow (fail-open). `allow` is valid ONLY as an `updatedInput`
 *    argument rewrite. (Claude Code, by contrast, honours a bare allow — that
 *    divergence is the whole reason this adapter overrides `emitPreToolUse`.)
 *  - deny requires a non-empty `permissionDecisionReason` (empty → invalid →
 *    fail-open); our formatters always produce one, so the delegated deny is fine.
 *  - `hookSpecificOutput` has `deny_unknown_fields`; top-level `systemMessage`
 *    is accepted but must stay top-level (the delegated shape already does this).
 *  - Stop `{ decision: "block", reason }`; SessionStart / UserPromptSubmit
 *    `hookSpecificOutput.additionalContext`; stdin snake_case — all identical.
 *
 * The Guard v3 gate never emits an `allow` on the Codex hook path (PROCEED_*
 * exits 0 with no output, which is a safe pass on Codex). The `allow` override
 * below is a fail-closed backstop: if a future gate change ever routes an allow
 * here, a bare (rewrite-less) allow is downgraded to no-output rather than
 * emitting a Codex-invalid payload that would silently fail-open.
 */
import { claudeCodeAdapter } from './claude-code.js';
export const codexAdapter = {
    host: 'codex',
    // Stdin field names match Claude Code's snake_case schema verbatim, so
    // the parse logic is identical. Delegating preserves a single source of
    // truth for stdin shape parsing.
    parsePreToolUseStdin(raw) {
        return claudeCodeAdapter.parsePreToolUseStdin(raw);
    },
    parseUserPromptSubmitStdin(raw) {
        return claudeCodeAdapter.parseUserPromptSubmitStdin(raw);
    },
    emitPreToolUse(decision) {
        // Codex rejects a bare `allow` (no `updatedInput`) as an unsupported
        // permissionDecision, which fails the hook open. Emit nothing instead —
        // no output is a safe pass on Codex, and never a fail-open deny.
        if (decision.kind === 'allow' && decision.updatedInput === undefined) {
            return '';
        }
        return claudeCodeAdapter.emitPreToolUse(decision);
    },
    emitSessionStartContext(additionalContext) {
        return claudeCodeAdapter.emitSessionStartContext(additionalContext);
    },
    emitUserPromptSubmitContext(additionalContext) {
        return claudeCodeAdapter.emitUserPromptSubmitContext(additionalContext);
    },
    emitStop(reason) {
        return claudeCodeAdapter.emitStop(reason);
    },
};
//# sourceMappingURL=codex.js.map