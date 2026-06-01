/**
 * Host-agnostic user-facing text for PreToolUse decisions.
 *
 * Each host's hook entrypoint calls these formatters to fill in `reason`
 * and `systemMessage` on its adapter's `emitPreToolUse(...)`. The strings
 * here are stable across hosts because the agent-facing protocol
 * instructions don't depend on which CLI ran the hook.
 */
import type { BlockResult, GateDecision } from './evaluate.js';

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
export function formatNoTokenSessionNotice(): string {
  return [
    'transcodes-guard: no Transcodes token is configured.',
    'Danger commands will be BLOCKED and step-up MFA cannot start until a token is set.',
    '',
    'How to fix (guide the user — the token must NOT be pasted into this chat,',
    'it would leak into the transcript):',
    '  1. Get the token from the Transcodes console → member detail page:',
    '       https://app.transcodes.io',
    '  2. In a terminal, run this ONCE:',
    '       npx @bigstrider/transcodes-cli login <token>',
    '     (saves it to ~/.transcodes/config.json so every agent session can find it)',
    '',
    'Alternatively, set the TRANSCODES_TOKEN environment variable before launching',
    'the host (note: GUI-launched apps often do NOT inherit your shell env, so the',
    'CLI login above is the more reliable option).',
  ].join('\n');
}

export function formatBlockedSummary(block: BlockResult): string {
  return [
    '⛔ BLOCKED — Bash was NOT executed.',
    '',
    `Reason : ${block.reason}`,
    ...(block.details && block.details.length > 0
      ? ['', 'Affected:', ...block.details.map((d) => `  - ${d}`)]
      : []),
    `Command: ${block.command}`,
  ].join('\n');
}

export function formatAllowReason(
  decision: Extract<GateDecision, { kind: 'allow' }>,
): string {
  return (
    'transcodes-guard: step-up MFA verified — overriding default permission policy. ' +
    `Original danger match: ${decision.block.reason}. Command: ${decision.block.command}`
  );
}

export function formatNoTokenReason(block: BlockResult): string {
  return (
    `Bash blocked by transcodes-guard: ${block.reason}. ` +
    'Step-up MFA gate is not configured (no Transcodes token found). ' +
    'Tell the user to get a token from the Transcodes console (member detail page, ' +
    'https://app.transcodes.io) and run `transcodes login <token>` (or set the ' +
    'TRANSCODES_TOKEN environment variable) to enable on-demand authentication, ' +
    'or run the command outside the agent.'
  );
}

export function formatNoTokenSystemMessage(block: BlockResult): string {
  return (
    `${formatBlockedSummary(block)}\n\n` +
    'Step-up MFA gate is not configured (no Transcodes token found).\n' +
    'Get a token from the Transcodes console → member detail page (https://app.transcodes.io),\n' +
    'then ask the user to run `transcodes login <token>` in a terminal (or set TRANSCODES_TOKEN),\n' +
    'and retry. Do not have the user paste the token into this chat.'
  );
}

export function formatStepupFailureDetail(
  decision: Extract<GateDecision, { kind: 'deny-stepup-failure' }>,
): string {
  const { failure } = decision;
  return failure.reason === 'no-token'
    ? 'No Transcodes token found — step-up MFA gate is unavailable. Get a token from the Transcodes console (https://app.transcodes.io member detail page), then run `transcodes login <token>`.'
    : failure.reason === 'create-failed'
      ? `Step-up MFA session could not be started${failure.detail ? ` (${failure.detail})` : ''}.`
      : `Step-up MFA gate errored${failure.detail ? ` (${failure.detail})` : ''}.`;
}

export function formatStepupFailureReason(
  decision: Extract<GateDecision, { kind: 'deny-stepup-failure' }>,
): string {
  return (
    `Bash blocked by transcodes-guard: ${decision.block.reason}. ${formatStepupFailureDetail(decision)} ` +
    'Report the failure to the user; do not retry until step-up is available.'
  );
}

export function formatStepupFailureSystemMessage(
  decision: Extract<GateDecision, { kind: 'deny-stepup-failure' }>,
): string {
  return `${formatBlockedSummary(decision.block)}\n\n${formatStepupFailureDetail(decision)}`;
}

export function formatStepupPendingReason(
  decision: Extract<GateDecision, { kind: 'deny-stepup-pending' }>,
): string {
  return (
    `Step-up MFA pending. sid=${decision.sid}. Open ${decision.browserUrl}, ` +
    'complete WebAuthn, then call MCP tool `poll_stepup_session_wait` ' +
    `with sid="${decision.sid}" and retry the same Bash command.`
  );
}

export function formatStepupPendingSystemMessage(
  decision: Extract<GateDecision, { kind: 'deny-stepup-pending' }>,
): string {
  const launchLine = decision.browserLaunched
    ? 'A browser tab has been opened automatically:'
    : 'A concurrent hook process already opened a tab — reuse it:';
  return [
    '🔐 BLOCKED — Step-up MFA required. This Bash command was NOT executed.',
    '',
    `Reason : ${decision.block.reason}`,
    `Command: ${decision.block.command}`,
    '',
    launchLine,
    `  ${decision.browserUrl}`,
    '',
    `Session id: ${decision.sid}`,
    '',
    'Agent — drive the step-up loop (do this WITHOUT asking the user for confirmation):',
    '  1. Tell the user (one short line) to complete WebAuthn in the opened tab ' +
      '(paste the URL above if it did not open).',
    `  2. Immediately call the MCP tool \`poll_stepup_session_wait\` with sid="${decision.sid}". ` +
      'It blocks until verified or 60s timeout — one call replaces the polling loop.',
    '  3. On `outcome: "verified"` retry the SAME Bash command — the hook detects the ' +
      'verified state and allows it. On `outcome: "timeout"` ask the user to retry ' +
      'WebAuthn, then call the wait tool again.',
  ].join('\n');
}

/**
 * Stderr 1-line summary tag for the hook process. Distinct from the
 * stdout JSON — this surface lands directly in the terminal under each
 * host's hook log channel.
 */
export function formatStderrTag(decision: GateDecision): string {
  switch (decision.kind) {
    case 'pass':
      return 'transcodes-guard: pass';
    case 'allow':
      return `transcodes-guard: ALLOWED (stepup-verified) — ${decision.block.command}`;
    case 'deny-no-token':
      return `transcodes-guard: BLOCKED (no token) — ${decision.block.command}`;
    case 'deny-stepup-failure':
      return `transcodes-guard: BLOCKED (stepup-failure) — ${decision.block.command}`;
    case 'deny-stepup-pending':
      return `transcodes-guard: STEPUP-PENDING sid=${decision.sid} — ${decision.block.command}`;
  }
}
