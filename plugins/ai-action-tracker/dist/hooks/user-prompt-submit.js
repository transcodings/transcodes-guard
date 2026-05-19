#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — bridges user → agent for the
 * step-up MFA loop.
 *
 * When the user types something like "인증 완료", "done", or "auth
 * passed" while a pending step-up session is in flight, the agent
 * cannot otherwise know which sid that ack refers to. This hook reads
 * the shared pending state and injects an `additionalContext` block
 * that names the sid, the original Bash command, and the next action
 * (call `poll_stepup_session`).
 *
 * The hook never blocks the prompt. Any error path is a no-op.
 */
import { isExpired, readPending } from "../src/stepup/pending.js";
// Loose matcher — false positives only matter when a pending record
// exists, in which case the worst case is one unnecessary poll call.
const COMPLETION_PATTERN = /완료|성공|끝났|마쳤|됐어|통과|done|finished|verified|authenticated|authori[sz]ed|complete|passed|success/i;
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
}
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
async function main() {
    let payload;
    try {
        payload = JSON.parse(await readStdin());
    }
    catch {
        process.exit(0);
    }
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    if (!prompt)
        process.exit(0);
    const pending = readPending();
    if (!pending || isExpired(pending))
        process.exit(0);
    const additionalContext = buildContext(prompt, pending);
    if (!additionalContext)
        process.exit(0);
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext,
        },
    }));
    process.exit(0);
}
main().catch((err) => {
    process.stderr.write(`ai-action-tracker user-prompt-submit hook error: ${err}\n`);
    process.exit(0);
});
//# sourceMappingURL=user-prompt-submit.js.map