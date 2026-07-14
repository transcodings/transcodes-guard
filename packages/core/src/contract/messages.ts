/**
 * Host-agnostic user-facing text for PreToolUse decisions.
 *
 * Each host's hook entrypoint calls these formatters to fill in `reason`
 * and `systemMessage` on its adapter's `emitPreToolUse(...)`. The strings
 * here are stable across hosts because the agent-facing protocol
 * instructions don't depend on which CLI ran the hook.
 *
 * These live in core/contract (public) — they are pure text formatters over
 * the `GateDecision` shape, carry no backend coupling, and let every host hook
 * render decisions without importing private code.
 */
import {
  type BlockResult,
  GATE_DECISION_KIND,
  type GateDecision,
} from './types.js';

/** Public GitHub repository — link in agent-facing protocol docs. */
export const TRANSCODES_GUARD_REPO_URL =
  'https://github.com/transcodings/transcodes-guard';

const APP_CONSOLE_RBAC_LOCATION = 'https://app.transcodes.io → RBAC → Roles';

function appendBackendReasoning(text: string, reasoning?: string): string {
  const trimmed = reasoning?.trim();
  if (!trimmed) return text;
  return `${text}\n\nBackend: ${trimmed}`;
}

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
  ].join('\n');
}

export function formatBlockedSummary(block: BlockResult): string {
  return [
    'Blocked by Transcodes: Bash was NOT executed.',
    '',
    `Reason : ${block.reason}`,
    ...(block.details && block.details.length > 0
      ? ['', 'Affected:', ...block.details.map((d) => `  - ${d}`)]
      : []),
    `Command: ${block.command}`,
  ].join('\n');
}

export function formatNoTokenReason(block: BlockResult): string {
  return (
    `Bash blocked by transcodes-guard: ${block.reason}. ` +
    'Step-up MFA gate is not configured (no Transcodes token found). ' +
    'Tell the user to install the CLI (`npm install -g @bigstrider/transcodes-cli`) ' +
    'and run `transcodes` to open the dashboard and paste a token from the Transcodes ' +
    'console (member detail page, https://app.transcodes.io). Non-interactive: ' +
    '`transcodes set <token> -l <label>`. Or run the command outside the agent.'
  );
}

export function formatNoTokenSystemMessage(block: BlockResult): string {
  return (
    `${formatBlockedSummary(block)}\n\n` +
    'Step-up MFA gate is not configured (no Transcodes token found).\n' +
    'Ask the user to install the CLI (`npm install -g @bigstrider/transcodes-cli`), run\n' +
    '`transcodes` to open the dashboard, and paste a token from the Transcodes console →\n' +
    'member detail page (https://app.transcodes.io). Non-interactive: `transcodes set <token>\n' +
    '-l <label>`. Then retry. Do not have the user paste the token into this chat.'
  );
}

export function formatBlockByPolicyReason(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY }
  >,
): string {
  return appendBackendReasoning(
    `Blocked by transcodes-guard: ${decision.block.reason}. ` +
      `Your RBAC role denies this action (resource="${decision.resource}", action="${decision.action}") — ` +
      'permission level 0 is a hard deny; step-up MFA only unlocks actions already at level 2. ' +
      'Report this to the user; do not retry. ' +
      `An admin must grant the permission at ${APP_CONSOLE_RBAC_LOCATION}. ` +
      'Do not use get_console_url or auth.transcodes.io for RBAC edits.',
    decision.reasoning,
  );
}

export function formatBlockByPolicySystemMessage(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY }
  >,
): string {
  return appendBackendReasoning(
    [
      formatBlockedSummary(decision.block),
      '',
      `RBAC permission DENIED — resource="${decision.resource}", action="${decision.action}".`,
      'Step-up MFA only unlocks actions already at level 2; it cannot elevate 0 → 2.',
      `An admin must grant the permission at ${APP_CONSOLE_RBAC_LOCATION}.`,
      'Do not use get_console_url or auth.transcodes.io for RBAC edits.',
      'Then retry. Do not retry until the permission is granted.',
    ].join('\n'),
    decision.reasoning,
  );
}

export function formatStepupCreateFailedDetail(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED }
  >,
): string {
  const { failure } = decision;
  return failure.reason === 'no-token'
    ? 'No Transcodes token found — step-up MFA gate is unavailable. Install the CLI (`npm install -g @bigstrider/transcodes-cli`), run `transcodes` to open the dashboard, and paste a token from the Transcodes console (https://app.transcodes.io member detail page). Non-interactive: `transcodes set <token> -l <label>`.'
    : failure.reason === 'create-failed'
      ? `Step-up MFA session could not be started${failure.detail ? ` (${failure.detail})` : ''}.`
      : `Step-up MFA gate errored${failure.detail ? ` (${failure.detail})` : ''}.`;
}

export function formatStepupCreateFailedReason(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED }
  >,
): string {
  return (
    `Bash blocked by transcodes-guard: ${decision.block.reason}. ${formatStepupCreateFailedDetail(decision)} ` +
    'Report the failure to the user; do not retry until step-up is available.'
  );
}

export function formatStepupCreateFailedSystemMessage(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED }
  >,
): string {
  return appendBackendReasoning(
    `${formatBlockedSummary(decision.block)}\n\n${formatStepupCreateFailedDetail(decision)}`,
    decision.reasoning,
  );
}

export function formatStepupChallengedReason(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED }
  >,
): string {
  return (
    `Step-up MFA pending. ${decision.resource}:${decision.action}. ` +
    `Open ${decision.browserUrl}, complete WebAuthn, then call MCP tool ` +
    '`tc_poll_stepup_session_wait` with ' +
    `resource="${decision.resource}" action="${decision.action}" ` +
    `(or sid="${decision.sid}") and retry the same Bash command.`
  );
}

export function formatStepupChallengedSystemMessage(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED }
  >,
): string {
  const launchLine = decision.browserLaunched
    ? 'A browser tab has been opened automatically:'
    : 'A concurrent hook process already opened a tab — reuse it:';
  return appendBackendReasoning(
    [
      'Pending for Step-up MFA authentication. This Bash command was NOT executed.',
      '',
      `Reason : ${decision.block.reason}`,
      `Command: ${decision.block.command}`,
      '',
      launchLine,
      `  ${decision.browserUrl}`,
      '',
      `Coordinate: ${decision.resource}:${decision.action}`,
      `Session id: ${decision.sid}`,
      '',
      'Agent — drive the step-up loop (do this WITHOUT asking the user for confirmation):',
      '  1. Tell the user (one short line) to complete WebAuthn in the opened tab ' +
        '(paste the URL above if it did not open).',
      '  2. Immediately call the MCP tool `tc_poll_stepup_session_wait` with ' +
        `resource="${decision.resource}" and action="${decision.action}" ` +
        '(sid optional). It waits up to ~5 min (session TTL) until verified or timeout.',
      '  3. On `outcome: "verified"` retry the SAME Bash command — the hook detects the ' +
        'verified state and allows it. On `outcome: "timeout"`, `outcome: "rejected"`, or ' +
        '`outcome: "not_found"`: tell the user in one short line that this command did not run; ' +
        'skip the blocked command; continue other work. Do NOT re-poll, reopen auth tabs, or ' +
        'retry the SAME blocked command unless the user explicitly asks to authenticate again. ' +
        'Do NOT invent an alternate command that works around the blocked action.',
      '  4. If the user says stop/cancel/skip at any time, abort this command immediately ' +
        'and continue other work — do not keep waiting.',
    ].join('\n'),
    decision.reasoning,
  );
}

export function formatStepupRejectedReason(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED }
  >,
): string {
  return (
    'Step-up MFA was declined. Tell the user this command did not run, skip it, ' +
    'and continue other work. Do not retry or poll unless they explicitly ask to ' +
    `authenticate again (${decision.resource}/${decision.action}).`
  );
}

/**
 * Static step-up loop primer for session-start / AGENTS.md / STEPUP.md / skills.
 * Keep `scripts/router-body.mjs` STEPUP_PROTOCOL_SECTION in sync.
 */
export function formatStepupProtocolPrimer(): string {
  return [
    'transcodes-guard step-up MFA protocol:',
    `Open source: ${TRANSCODES_GUARD_REPO_URL}`,
    '',
    'When a PreToolUse hook denies with Step-up MFA, the command was BLOCKED',
    'and did NOT execute. Drive the loop deterministically — do NOT wait for',
    'user confirmation before calling the wait tool:',
    '',
    '  1. Tell the user (one short line) to complete WebAuthn in the opened tab',
    '     (paste the URL from the deny message if it did not open).',
    '  2. Immediately call MCP tool `tc_poll_stepup_session_wait` with',
    '     resource+action from the deny (sid optional). Waits up to ~5 min (session TTL)',
    '     until verified or timeout.',
    '  3. verified → retry the SAME blocked command.',
    '     timeout, rejected, or not_found → tell the user (one short line) this',
    '     command did not run; skip the blocked command; continue other work.',
    '     Do NOT re-poll, reopen auth tabs, or retry the SAME blocked command',
    '     unless the user explicitly asks to authenticate again.',
    '  4. If the user says stop/cancel/skip at any time, abort this command and',
    '     continue other work — do not keep waiting.',
    '  Do not invent an alternate command that works around the blocked action.',
    '',
    'Never assume the blocked command ran. Never invent an alternative command.',
    'Always resume from the resource/action (or sid) the hook reported.',
    '',
    'Step-up MFA only unlocks actions already at RBAC level 2; it cannot elevate level 0 → 2.',
    `Level 0 changes require an admin at ${APP_CONSOLE_RBAC_LOCATION}; get_console_url cannot edit RBAC.`,
  ].join('\n');
}

export function formatPollStepupSessionWaitAgentContext(): string {
  return [
    'verified → retry the same blocked command.',
    'timeout, rejected, or not_found → tell the user (one short line) this command did not run; skip the blocked command; continue other work.',
    'Do NOT re-poll, reopen auth tabs, or retry the SAME blocked command unless the user explicitly asks to authenticate again.',
    'Do not invent an alternate command that works around the blocked action.',
    'If the user says stop/cancel/skip at any time → abort this command and continue other work; do not keep waiting.',
  ].join('\n');
}

export function formatStepupRejectedSystemMessage(
  decision: Extract<
    GateDecision,
    { kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED }
  >,
): string {
  return appendBackendReasoning(
    [
      'BLOCKED — Step-up MFA declined. This command was NOT executed.',
      '',
      `Reason : ${decision.block.reason}`,
      `Command: ${decision.block.command}`,
      `Coordinate: ${decision.resource}/${decision.action}`,
      '',
      'The user rejected WebAuthn for this grouped step-up challenge.',
      '',
      'Agent — end the step-up loop, then continue other work:',
      '  1. Tell the user in one short line that step-up MFA was declined ' +
        'and this command did not run.',
      '  2. Do NOT call `tc_poll_stepup_session_wait` or `tc_poll_stepup_session` — ' +
        'the challenge is terminal for this command.',
      '  3. Skip this blocked command. Do NOT retry it or invent an alternate ' +
        'command that works around the block.',
      '  4. Continue other unrelated work in the plan. Only start step-up again ' +
        'for this command if the user explicitly asks to authenticate and retry.',
      '',
      'Protocol: rejected ends MFA for this command only — skip it and continue.',
      'Security fatigue: do not reopen auth tabs or nag for MFA after a decline.',
    ].join('\n'),
    decision.reasoning,
  );
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
    case GATE_DECISION_KIND.BLOCK_NO_TOKEN:
      return `transcodes-guard: BLOCKED (no token) — ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_BY_POLICY:
      return `transcodes-guard: BLOCKED (by-policy ${decision.resource}/${decision.action}) — ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED:
      return `transcodes-guard: BLOCKED (stepup-create-failed) — ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED:
      return `transcodes-guard: STEPUP-CHALLENGED sid=${decision.sid} — ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED:
      return `transcodes-guard: STEPUP-REJECTED ${decision.resource}/${decision.action} — ${decision.block.command}`;
  }
}
