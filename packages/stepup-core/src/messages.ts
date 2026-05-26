/**
 * Host-agnostic user-facing text for PreToolUse decisions.
 *
 * Each host's hook entrypoint calls these formatters to fill in `reason`
 * and `systemMessage` on its adapter's `emitPreToolUse(...)`. The strings
 * here are stable across hosts because the agent-facing protocol
 * instructions don't depend on which CLI ran the hook.
 */
import type { BlockResult, GateDecision } from "./evaluate.js";

export function formatBlockedSummary(block: BlockResult): string {
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

export function formatAllowReason(
  decision: Extract<GateDecision, { kind: "allow" }>,
): string {
  return (
    `ai-action-tracker: step-up MFA verified — overriding default permission policy. ` +
    `Original danger match: ${decision.block.reason}. Command: ${decision.block.command}`
  );
}

export function formatNoTokenReason(block: BlockResult): string {
  return (
    `Bash blocked by ai-action-tracker: ${block.reason}. ` +
    "Step-up MFA gate is not configured (TRANSCODES_TOKEN missing). " +
    "Tell the user to set TRANSCODES_TOKEN to enable on-demand authentication, " +
    "or run the command outside Claude Code."
  );
}

export function formatNoTokenSystemMessage(block: BlockResult): string {
  return (
    `${formatBlockedSummary(block)}\n\n` +
    "Step-up MFA gate is not configured (TRANSCODES_TOKEN missing). " +
    "Ask the user to set the token, then retry."
  );
}

export function formatStepupFailureDetail(
  decision: Extract<GateDecision, { kind: "deny-stepup-failure" }>,
): string {
  const { failure } = decision;
  return failure.reason === "no-token"
    ? "TRANSCODES_TOKEN is missing — step-up MFA gate is unavailable."
    : failure.reason === "create-failed"
      ? `Step-up MFA session could not be started${failure.detail ? ` (${failure.detail})` : ""}.`
      : `Step-up MFA gate errored${failure.detail ? ` (${failure.detail})` : ""}.`;
}

export function formatStepupFailureReason(
  decision: Extract<GateDecision, { kind: "deny-stepup-failure" }>,
): string {
  return (
    `Bash blocked by ai-action-tracker: ${decision.block.reason}. ${formatStepupFailureDetail(decision)} ` +
    "Report the failure to the user; do not retry until step-up is available."
  );
}

export function formatStepupFailureSystemMessage(
  decision: Extract<GateDecision, { kind: "deny-stepup-failure" }>,
): string {
  return `${formatBlockedSummary(decision.block)}\n\n${formatStepupFailureDetail(decision)}`;
}

export function formatStepupPendingReason(
  decision: Extract<GateDecision, { kind: "deny-stepup-pending" }>,
): string {
  return (
    `Step-up MFA pending. sid=${decision.sid}. Open ${decision.browserUrl}, ` +
    "complete WebAuthn, then call MCP tool `poll_stepup_session_wait` " +
    `with sid="${decision.sid}" and retry the same Bash command.`
  );
}

export function formatStepupPendingSystemMessage(
  decision: Extract<GateDecision, { kind: "deny-stepup-pending" }>,
): string {
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
export function formatStderrTag(decision: GateDecision): string {
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
