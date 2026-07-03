/**
 * The GateBackend DI interface.
 *
 * One interface covers both consumption paths:
 *   - hook path: evaluatePreToolUse + the pending/verified side-effect helpers
 *     the hook entrypoints call after emitting their decision.
 *   - server path: the step-up session tools, RBAC-coordinate validation, and
 *     the backend MCP tool registration.
 *
 * The real implementation lives in `@transcodes-guard/gate-backend` and
 * is registered via `setGateBackend()` at plugin bootstrap. The public side
 * (mcp-server-core + hooks) only ever calls `getGateBackend()`.
 *
 * Config-less by design: methods like `createStepupSession(args)` and
 * `assertRbacCoordinate(resource, action)` load the StepupConfig internally so
 * that `StepupConfig` (a backend-coupled type) never crosses into the public
 * surface. Error classes are likewise hidden behind `is*Error(e)` predicates
 * (instanceof would require exporting the class).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CreatedStepupSession, CreateStepupArgs, GateDecision, PollStepupResult, StepupStateInspection, ToolCallInput, WaitStepupResult } from './types.js';
export interface GateBackend {
    evaluatePreToolUse(input: ToolCallInput): Promise<GateDecision>;
    /** Mint a fresh per-prompt grouping sid (prompt-submit / session-start). */
    rotatePromptSid(): void;
    /** Reap expired browser/poll latches (Stop-hook housekeeping). */
    sweepLatches(now?: number): void;
    /** Whether a Transcodes token is resolvable (session-start no-token notice). */
    hasToken(): boolean;
    /**
     * Fire-and-forget decision audit (Phase3 v2 H2). Call AFTER the decision
     * JSON is on stdout — never rejects, bounded by a sub-second timeout, and
     * a silent no-op for `pass` decisions or when no token is resolvable.
     */
    sendGateDecisionAudit(decision: GateDecision): Promise<void>;
    createStepupSession(args: CreateStepupArgs): Promise<CreatedStepupSession>;
    pollStepupSession(sid: string): Promise<PollStepupResult>;
    pollStepupSessionWait(sid: string, options?: {
        maxWaitMs?: number;
        intervalMs?: number;
    }): Promise<WaitStepupResult>;
    inspectStepupState(): StepupStateInspection;
    /** Record a backend-verified sid in the server's in-memory verified set so the
     * `execProtectedTool` handler backstop can consume it (single-shot). Called
     * by the poll tools on `verified`.
     */
    markStepupVerified(sid: string): void;
    /** Drop the latch for a terminal poll (rejected / not-found). */
    clearLatchByAuthSid(authSid: string): void;
    assertRbacCoordinate(resource: string, action: string): Promise<void>;
    isRbacCoordinateError(e: unknown): e is Error;
    registerBackendTools(server: McpServer): void;
}
