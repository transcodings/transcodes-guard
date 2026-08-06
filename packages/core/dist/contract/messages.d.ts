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
import { type BlockResult, GATE_DECISION_KIND, type GateDecision } from './types.js';
/** Public GitHub repository — link in agent-facing protocol docs. */
export declare const TRANSCODES_GUARD_REPO_URL = "https://github.com/transcodings/transcodes-guard";
/** Bootstrap installers (Node optional). Served from the public prod branch. */
export declare const CLI_INSTALL_SH_URL = "https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh";
export declare const CLI_INSTALL_PS1_URL = "https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1";
/** One-line install hints for agent-facing "no token" guidance. */
export declare const CLI_INSTALL_HINT_UNIX = "curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install";
/** Prefer a standard (non-Administrator) PowerShell window. */
export declare const CLI_INSTALL_HINT_WIN = "Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install";
/**
 * Session-start notice text shown when no Transcodes token is configured.
 *
 * Pure formatter — it does NOT decide whether to show itself. The caller is
 * responsible for the token lookup (`backend.hasToken()`) and only renders
 * this when no token is found.
 */
export declare function formatNoTokenSessionNotice(): string;
export declare function formatBlockedSummary(block: BlockResult): string;
export declare function formatNoTokenReason(block: BlockResult): string;
export declare function formatNoTokenSystemMessage(block: BlockResult): string;
export declare function formatBlockByPolicyReason(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY;
}>): string;
export declare function formatBlockByPolicySystemMessage(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_BY_POLICY;
}>): string;
export declare function formatStepupCreateFailedDetail(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
}>): string;
export declare function formatStepupCreateFailedReason(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
}>): string;
export declare function formatStepupCreateFailedSystemMessage(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED;
}>): string;
export declare function formatStepupChallengedReason(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
}>): string;
export declare function formatStepupChallengedSystemMessage(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED;
}>): string;
export declare function formatStepupRejectedReason(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED;
}>): string;
/**
 * Static step-up loop primer for session-start / AGENTS.md / STEPUP.md / skills.
 * Keep `scripts/router-body.mjs` STEPUP_PROTOCOL_SECTION in sync.
 */
export declare function formatStepupProtocolPrimer(): string;
export declare function formatPollStepupSessionWaitAgentContext(): string;
export declare function formatStepupRejectedSystemMessage(decision: Extract<GateDecision, {
    kind: typeof GATE_DECISION_KIND.BLOCK_STEPUP_REJECTED;
}>): string;
/**
 * Stderr 1-line summary tag for the hook process. Distinct from the
 * stdout JSON — this surface lands directly in the terminal under each
 * host's hook log channel.
 *
 * Exactly one line, always: the decision-bearing prefix is machine-readable
 * (`simulate_hook_invocation` parses it) and the trailing command is folded to
 * a single line so it can never forge one.
 */
export declare function formatStderrTag(decision: GateDecision): string;
