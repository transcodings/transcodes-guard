#!/usr/bin/env node
/**
 * Codex CLI UserPromptSubmit hook — same logic as the Claude Code variant.
 *
 * Detects user prompts that signal step-up completion and injects a sid +
 * next-action context block. Identical body to the Claude Code hook except
 * for the adapter import.
 */
import { readFileSync } from "node:fs";
import { codexAdapter } from "@ai-action-tracker/hook-adapters";
import { isExpired, readPending, } from "@ai-action-tracker/stepup-core";
const COMPLETION_PATTERN = /완료|성공|끝났|마쳤|됐어|통과|done|finished|verified|authenticated|authori[sz]ed|complete|passed|success/i;
function buildContext(prompt, pending) {
    if (!COMPLETION_PATTERN.test(prompt))
        return null;
    const statusNote = pending.status === "verified"
        ? "already verified — just retry the original command."
        : "still pending — call poll_stepup_session_wait now to block until verified.";
    return [
        "ai-action-tracker: user appears to report step-up MFA completion.",
        "",
        `Pending session sid : ${pending.sid}`,
        `Status              : ${pending.status} (${statusNote})`,
        `Original command    : ${pending.command}`,
        "",
        "Next action:",
        `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
        '  - On `outcome: "verified"` retry the exact original Bash command above.',
    ].join("\n");
}
function main() {
    const raw = readFileSync(0, "utf8");
    let parsed;
    try {
        parsed = codexAdapter.parseUserPromptSubmitStdin(raw);
    }
    catch {
        process.exit(0);
    }
    if (!parsed.prompt)
        process.exit(0);
    const pending = readPending();
    if (!pending || isExpired(pending))
        process.exit(0);
    const additionalContext = buildContext(parsed.prompt, pending);
    if (!additionalContext)
        process.exit(0);
    process.stdout.write(codexAdapter.emitUserPromptSubmitContext(additionalContext));
    process.exit(0);
}
try {
    main();
}
catch (err) {
    process.stderr.write(`ai-action-tracker user-prompt-submit hook error: ${err}\n`);
    process.exit(0);
}
//# sourceMappingURL=user-prompt-submit.js.map