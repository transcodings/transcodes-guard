/**
 * Session-start notice text shown when no Transcodes token is configured.
 *
 * Pure formatter — it does NOT decide whether to show itself. The caller is
 * responsible for the token lookup (`resolveToken().token`) and only renders
 * this when no token is found. Keeping the env/file I/O out of this module
 * preserves it as host-agnostic *text* (see file header); all four hosts
 * share this one wording. Nudges first-time users toward `transcodes login`
 * BEFORE they hit a blocked command. The token must be set in a terminal,
 * never pasted into the agent chat (that would leak it into the transcript).
 */
export function formatNoTokenSessionNotice() {
    return [
        "ai-action-tracker: no Transcodes token is configured.",
        "Danger commands will be BLOCKED and step-up MFA cannot start until a token is set.",
        "",
        "Tell the user to run this ONCE in their terminal (NOT in this chat — the",
        "token must not be pasted here):",
        "  npx @bigstrider/transcodes-cli login <token>",
        "",
        "Alternatively they can set the TRANSCODES_TOKEN environment variable.",
    ].join("\n");
}
export function formatBlockedSummary(block) {
    return [
        "⛔ BLOCKED — Bash was NOT executed.",
        "",
        `Reason : ${block.reason}`,
        ...(block.details && block.details.length > 0
            ? ["", "Affected:", ...block.details.map((d) => `  - ${d}`)]
            : []),
        `Command: ${block.command}`,
    ].join("\n");
}
export function formatAllowReason(decision) {
    return (`ai-action-tracker: step-up MFA verified — overriding default permission policy. ` +
        `Original danger match: ${decision.block.reason}. Command: ${decision.block.command}`);
}
export function formatNoTokenReason(block) {
    return (`Bash blocked by ai-action-tracker: ${block.reason}. ` +
        "Step-up MFA gate is not configured (no Transcodes token found). " +
        "Tell the user to run `transcodes login <token>` (or set the " +
        "TRANSCODES_TOKEN environment variable) to enable on-demand authentication, " +
        "or run the command outside the agent.");
}
export function formatNoTokenSystemMessage(block) {
    return (`${formatBlockedSummary(block)}\n\n` +
        "Step-up MFA gate is not configured (no Transcodes token found). " +
        "Ask the user to run `transcodes login <token>` (or set TRANSCODES_TOKEN), then retry.");
}
export function formatStepupFailureDetail(decision) {
    const { failure } = decision;
    return failure.reason === "no-token"
        ? "No Transcodes token found — step-up MFA gate is unavailable. Run `transcodes login <token>`."
        : failure.reason === "create-failed"
            ? `Step-up MFA session could not be started${failure.detail ? ` (${failure.detail})` : ""}.`
            : `Step-up MFA gate errored${failure.detail ? ` (${failure.detail})` : ""}.`;
}
export function formatStepupFailureReason(decision) {
    return (`Bash blocked by ai-action-tracker: ${decision.block.reason}. ${formatStepupFailureDetail(decision)} ` +
        "Report the failure to the user; do not retry until step-up is available.");
}
export function formatStepupFailureSystemMessage(decision) {
    return `${formatBlockedSummary(decision.block)}\n\n${formatStepupFailureDetail(decision)}`;
}
export function formatStepupPendingReason(decision) {
    return (`Step-up MFA pending. sid=${decision.sid}. Open ${decision.browserUrl}, ` +
        "complete WebAuthn, then call MCP tool `poll_stepup_session_wait` " +
        `with sid="${decision.sid}" and retry the same Bash command.`);
}
export function formatStepupPendingSystemMessage(decision) {
    const launchLine = decision.browserLaunched
        ? "A browser tab has been opened automatically:"
        : "A concurrent hook process already opened a tab — reuse it:";
    return [
        "🔐 BLOCKED — Step-up MFA required. This Bash command was NOT executed.",
        "",
        `Reason : ${decision.block.reason}`,
        `Command: ${decision.block.command}`,
        "",
        launchLine,
        `  ${decision.browserUrl}`,
        "",
        `Session id: ${decision.sid}`,
        "",
        "Agent — drive the step-up loop (do this WITHOUT asking the user for confirmation):",
        "  1. Tell the user (one short line) to complete WebAuthn in the opened tab " +
            "(paste the URL above if it did not open).",
        `  2. Immediately call the MCP tool \`poll_stepup_session_wait\` with sid="${decision.sid}". ` +
            "It blocks until verified or 60s timeout — one call replaces the polling loop.",
        '  3. On `outcome: "verified"` retry the SAME Bash command — the hook detects the ' +
            'verified state and allows it. On `outcome: "timeout"` ask the user to retry ' +
            "WebAuthn, then call the wait tool again.",
    ].join("\n");
}
/**
 * Stderr 1-line summary tag for the hook process. Distinct from the
 * stdout JSON — this surface lands directly in the terminal under each
 * host's hook log channel.
 */
export function formatStderrTag(decision) {
    switch (decision.kind) {
        case "pass":
            return "ai-action-tracker: pass";
        case "allow":
            return `ai-action-tracker: ALLOWED (stepup-verified) — ${decision.block.command}`;
        case "deny-no-token":
            return `ai-action-tracker: BLOCKED (no token) — ${decision.block.command}`;
        case "deny-stepup-failure":
            return `ai-action-tracker: BLOCKED (stepup-failure) — ${decision.block.command}`;
        case "deny-stepup-pending":
            return `ai-action-tracker: STEPUP-PENDING sid=${decision.sid} — ${decision.block.command}`;
    }
}
//# sourceMappingURL=messages.js.map