/**
 * Host-agnostic user-facing text for PreToolUse decisions.
 *
 * Each host's hook entrypoint calls these formatters to fill in `reason`
 * and `systemMessage` on its adapter's `emitPreToolUse(...)`. The strings
 * here are stable across hosts because the agent-facing protocol
 * instructions don't depend on which CLI ran the hook.
 *
 * These live in gate-contract (public) — they are pure text formatters over
 * the `GateDecision` shape, carry no backend coupling, and let every host hook
 * render decisions without importing private code.
 */
import {
  type BlockResult,
  GATE_DECISION_KIND,
  type GateDecision,
} from './types.js';

/**
 * Session-start notice text shown when no Transcodes token is configured.
 *
 * Pure formatter — it does NOT decide whether to show itself. The caller is
 * responsible for the token lookup (`backend.hasToken()`) and only renders
 * this when no token is found.
 */
export function formatNoTokenSessionNotice(): string {
  return [
    'transcodes-guard: no Transcodes token is configured.',
    'Danger commands will be BLOCKED and step-up MFA cannot start until a token is set.',
    '',
    'How to fix (guide the user — the token must NOT be pasted into this chat,',
    'it would leak into the transcript):',
    '',
    '  RECOMMENDED — install the CLI once, then enter the token in the dashboard:',
    '    1. npm install -g @bigstrider/transcodes-cli',
    '    2. transcodes        (opens the dashboard at your local device browser)',
    '    3. Paste the token from the Transcodes console → member detail page',
    '       (https://app.transcodes.io) into the dashboard.',
    '  Saved to ~/.transcodes/config.json so every agent session can find it.',
    '',
    '  Non-interactive alternative (same store, e.g. for scripts):',
    '    transcodes set <token> -l <label>',
    '',
    '  For config-less envs (CI): set the TRANSCODES_TOKEN environment',
    '  variable before launching the host (a fallback used only when no token is',
    '  saved). Note: GUI-launched apps often do NOT inherit your shell env, so the',
    '  CLI dashboard above is the more reliable option for desktop hosts.',
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
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.PROCEED_BY_VERIFICATION }
  >,
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
    'Tell the user to install the CLI (`npm install -g @bigstrider/transcodes-cli`) ' +
    'and run `transcodes` to open the dashboard and paste a token from the Transcodes ' +
    'console (member detail page, https://app.transcodes.io). Non-interactive: ' +
    '`transcodes set <token> -l <label>`. For CI only, set the TRANSCODES_TOKEN ' +
    'environment variable. Or run the command outside the agent.'
  );
}

export function formatNoTokenSystemMessage(block: BlockResult): string {
  return (
    `${formatBlockedSummary(block)}\n\n` +
    'Step-up MFA gate is not configured (no Transcodes token found).\n' +
    'Ask the user to install the CLI (`npm install -g @bigstrider/transcodes-cli`), run\n' +
    '`transcodes` to open the dashboard, and paste a token from the Transcodes console →\n' +
    'member detail page (https://app.transcodes.io). Non-interactive: `transcodes set <token>\n' +
    '-l <label>`; CI only: TRANSCODES_TOKEN. Then retry. Do not have the user paste the token into this chat.'
  );
}

export function formatRbacDeniedReason(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY }
  >,
): string {
  return (
    `Blocked by transcodes-guard: ${decision.block.reason}. ` +
    `Your RBAC role denies this action (resource="${decision.resource}", action="${decision.action}") — ` +
    'step-up MFA cannot grant it. Report this to the user; do not retry. ' +
    'An admin must grant the permission in the Transcodes console (RBAC → Roles).'
  );
}

export function formatRbacDeniedSystemMessage(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY }
  >,
): string {
  return [
    formatBlockedSummary(decision.block),
    '',
    `RBAC permission DENIED — resource="${decision.resource}", action="${decision.action}".`,
    'Your role has no access to this action, so step-up MFA cannot unlock it.',
    'An admin must grant the permission in the Transcodes console (RBAC → Roles),',
    'then retry. Do not retry until the permission is granted.',
  ].join('\n');
}

export function formatStepupFailureDetail(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED }
  >,
): string {
  const { failure } = decision;
  return failure.reason === 'no-token'
    ? 'No Transcodes token found — step-up MFA gate is unavailable. Install the CLI (`npm install -g @bigstrider/transcodes-cli`), run `transcodes` to open the dashboard, and paste a token from the Transcodes console (https://app.transcodes.io member detail page). Non-interactive: `transcodes set <token> -l <label>`.'
    : failure.reason === 'create-failed'
      ? `Step-up MFA session could not be started${
          failure.detail ? ` (${failure.detail})` : ''
        }.`
      : `Step-up MFA gate errored${
          failure.detail ? ` (${failure.detail})` : ''
        }.`;
}

export function formatStepupFailureReason(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED }
  >,
): string {
  return (
    `Bash blocked by transcodes-guard: ${
      decision.block.reason
    }. ${formatStepupFailureDetail(decision)} ` +
    'Report the failure to the user; do not retry until step-up is available.'
  );
}

export function formatStepupFailureSystemMessage(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED }
  >,
): string {
  return `${formatBlockedSummary(
    decision.block,
  )}\n\n${formatStepupFailureDetail(decision)}`;
}

export function formatStepupPendingReason(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED }
  >,
): string {
  return (
    `Step-up MFA pending. sid=${decision.sid}. Open ${decision.browserUrl}, ` +
    'complete WebAuthn, then call MCP tool `poll_stepup_session_wait` ' +
    `with sid="${decision.sid}" and retry the same Bash command.`
  );
}

export function formatStepupPendingSystemMessage(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED }
  >,
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
      'WebAuthn, then call the wait tool again. On `outcome: "rejected"` tell the user ' +
      'they declined step-up; do NOT retry the command unless they explicitly ask.',
  ].join('\n');
}

/**
 * Stderr 1-line summary tag for the hook process. Distinct from the
 * stdout JSON — this surface lands directly in the terminal under each
 * host's hook log channel.
 */
export function formatStderrTag(decision: GateDecision): string {
  switch (decision.kind) {
    case GATE_DECISION_KIND.PROCEED_UNGATED:
    case GATE_DECISION_KIND.PROCEED_BY_POLICY:
      return 'transcodes-guard: pass';
    case GATE_DECISION_KIND.PROCEED_BY_VERIFICATION:
      return `transcodes-guard: ALLOWED (stepup-verified) — ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_NO_TOKEN:
      return `transcodes-guard: BLOCKED (no token) — ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_BY_POLICY:
      return `transcodes-guard: BLOCKED (rbac-denied ${decision.resource}/${decision.action}) — ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED:
      return `transcodes-guard: BLOCKED (stepup-failure) — ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED:
      return `transcodes-guard: STEPUP-PENDING sid=${decision.sid} — ${decision.block.command}`;
  }
}
