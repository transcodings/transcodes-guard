#!/usr/bin/env node
/**
 * Cursor PreToolUse hook — shared entry for beforeShellExecution and
 * beforeMCPExecution.
 *
 * Wire format diverges from Claude Code: stdout is FLAT
 * `{ permission: "allow"|"deny", user_message?, agent_message?, updated_input? }`
 * with no `hookSpecificOutput` wrapper. The cursorAdapter renders this;
 * everything else (stdin parse, gate evaluation, side-effect ordering)
 * mirrors the Claude Code / Codex entrypoint verbatim.
 *
 * Cursor's stdin already uses snake_case (`tool_name`, `tool_input`, `cwd`),
 * matching Claude Code, so parsing delegates to claudeCodeAdapter through
 * cursorAdapter. The classifier in stepup-core accepts `Shell` (Cursor) in
 * addition to `Bash` / `run_command`.
 */
import { readFileSync } from "node:fs";
import { cursorAdapter } from "@ai-action-tracker/hook-adapters";
import { clearPending, consumeVerified, evaluatePreToolUse, formatAllowReason, formatNoTokenReason, formatNoTokenSystemMessage, formatStderrTag, formatStepupFailureReason, formatStepupFailureSystemMessage, formatStepupPendingReason, formatStepupPendingSystemMessage, writePending, } from "@ai-action-tracker/stepup-core";
async function main() {
    const raw = readFileSync(0, "utf8");
    let input;
    try {
        input = cursorAdapter.parsePreToolUseStdin(raw);
    }
    catch {
        process.exit(0);
    }
    const decision = await evaluatePreToolUse(input);
    switch (decision.kind) {
        case "pass":
            process.exit(0);
        case "allow":
            process.stdout.write(cursorAdapter.emitPreToolUse({
                kind: "allow",
                reason: formatAllowReason(decision),
            }));
            if (decision.consumeHere) {
                consumeVerified();
                clearPending();
            }
            process.stderr.write(`${formatStderrTag(decision)}\n`);
            process.exit(0);
        case "deny-no-token":
            process.stdout.write(cursorAdapter.emitPreToolUse({
                kind: "deny",
                reason: formatNoTokenReason(decision.block),
                systemMessage: formatNoTokenSystemMessage(decision.block),
            }));
            process.stderr.write(`${formatStderrTag(decision)}\n`);
            process.exit(0);
        case "deny-stepup-failure":
            process.stdout.write(cursorAdapter.emitPreToolUse({
                kind: "deny",
                reason: formatStepupFailureReason(decision),
                systemMessage: formatStepupFailureSystemMessage(decision),
            }));
            process.stderr.write(`${formatStderrTag(decision)}\n`);
            process.exit(0);
        case "deny-stepup-pending":
            process.stdout.write(cursorAdapter.emitPreToolUse({
                kind: "deny",
                reason: formatStepupPendingReason(decision),
                systemMessage: formatStepupPendingSystemMessage(decision),
            }));
            try {
                writePending(decision.pending);
            }
            catch (err) {
                process.stderr.write(`ai-action-tracker: pending file write failed (deny still emitted): ${err}\n`);
            }
            process.stderr.write(`${formatStderrTag(decision)}\n`);
            process.exit(0);
    }
}
main().catch((err) => {
    process.stderr.write(`ai-action-tracker hook error: ${err}\n`);
    process.exit(0);
});
//# sourceMappingURL=pre-tool-use.js.map