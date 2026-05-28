#!/usr/bin/env node
/**
 * Antigravity 2.0 PreInvocation hook — SessionStart + UserPromptSubmit fusion.
 *
 * Antigravity has no SessionStart or UserPromptSubmit hook events
 * (PreToolUse / PostToolUse / PreInvocation / PostInvocation / Stop is the
 * complete event list per antigravity.google/docs/hooks). PreInvocation
 * fires before every model call, and this entry uses it for both roles:
 *
 *  - **SessionStart-equivalent** (`invocationNum <= 1` — first model call,
 *    with a defensive fallback when the field is missing/non-numeric so a
 *    malformed payload still receives the primer; the primer is purely
 *    informational, so over-firing is harmless): inject a static step-up
 *    MFA primer + any carry-over pending state from a previous turn. The
 *    static primer rendered here duplicates what `rules/STEPUP.md` contains
 *    so the agent has the protocol in context immediately, even if
 *    Antigravity hasn't yet processed the rules file.
 *
 *  - **UserPromptSubmit-equivalent** (every invocation): tail the host's
 *    `transcript.jsonl` for the most recent user message. If it matches
 *    the completion pattern (`완료`, `done`, `verified`, …) AND a step-up
 *    session is live, inject a notice surfacing the pending `sid` so the
 *    agent can call `poll_stepup_session_wait`.
 *
 * Both injections land in the same `injectSteps` array, emitted via
 * antigravityAdapter.emitPreInvocation. Empty array → empty `{}` payload.
 */
import "../host.js";
import { readFileSync } from "node:fs";
import { antigravityAdapter, detectUserDoneFromTranscript, } from "@ai-action-tracker/hook-adapters";
import { isExpired, readPending, } from "@ai-action-tracker/stepup-core";
function primerMessage(pending) {
    const base = [
        "ai-action-tracker step-up MFA protocol primer:",
        "",
        "When a PreToolUse hook denies a shell or MCP tool call with reason",
        "mentioning Step-up MFA, the command was BLOCKED and did NOT execute.",
        "Drive the loop deterministically — do NOT wait for user confirmation",
        "between steps:",
        "  1. Tell the user (one short line) to complete WebAuthn in the",
        "     auto-opened browser tab (paste the URL from the deny message if",
        "     it did not open).",
        "  2. Immediately call MCP tool `poll_stepup_session_wait` with the sid",
        "     from the deny message. It blocks until verified or 60s timeout.",
        '  3. On `outcome: "verified"` retry the same command — the hook detects',
        "     the verified state and allows it.",
        '  4. On `outcome: "timeout"` ask the user to retry WebAuthn, then call',
        "     the wait tool again.",
        "",
        "Never assume the blocked command ran. Never invent an alternative",
        "command. Always resume from the pending sid the hook reported.",
    ];
    if (pending && !isExpired(pending)) {
        base.push("", "Carried-over step-up state from a previous turn:", `  sid     : ${pending.sid}`, `  status  : ${pending.status}`, `  command : ${pending.command}`, `  url     : ${pending.browserUrl}`);
    }
    return base.join("\n");
}
function userDoneNotice(pending, matchedContent) {
    const trimmed = matchedContent.length > 80
        ? matchedContent.slice(0, 77) + "..."
        : matchedContent;
    const statusNote = pending.status === "verified"
        ? "already verified — just retry the original command."
        : "still pending — call poll_stepup_session_wait now to block until verified.";
    return [
        `ai-action-tracker: user message matched completion pattern ("${trimmed}").`,
        "",
        `Pending session sid : ${pending.sid}`,
        `Status              : ${pending.status} (${statusNote})`,
        `Original command    : ${pending.command}`,
        "",
        "Next action:",
        `  - Call MCP tool \`poll_stepup_session_wait\` with sid="${pending.sid}".`,
        '  - On `outcome: "verified"` retry the exact original command above.',
    ].join("\n");
}
function main() {
    if (!antigravityAdapter.parsePreInvocationStdin ||
        !antigravityAdapter.emitPreInvocation) {
        // antigravityAdapter is missing optional PreInvocation methods —
        // shouldn't happen unless the package is mis-built. Fail-open.
        process.exit(0);
    }
    const raw = readFileSync(0, "utf8");
    let input;
    try {
        input = antigravityAdapter.parsePreInvocationStdin(raw);
    }
    catch {
        process.exit(0);
    }
    const pending = readPending();
    const injectSteps = [];
    // SessionStart-equivalent: primer + carry-over on first invocation only.
    if (input.invocationNum <= 1) {
        injectSteps.push({ ephemeralMessage: primerMessage(pending) });
    }
    // UserPromptSubmit-equivalent: surface pending sid when the user's last
    // message reports completion. Skipped when no pending session is in
    // flight (nothing to resume).
    if (pending && !isExpired(pending)) {
        const matched = detectUserDoneFromTranscript(input.transcriptPath);
        if (matched) {
            injectSteps.push({
                ephemeralMessage: userDoneNotice(pending, matched),
            });
        }
    }
    process.stdout.write(antigravityAdapter.emitPreInvocation(injectSteps));
    process.exit(0);
}
try {
    main();
}
catch (err) {
    process.stderr.write(`ai-action-tracker pre-invocation hook error: ${err}\n`);
    process.exit(0);
}
//# sourceMappingURL=pre-invocation.js.map