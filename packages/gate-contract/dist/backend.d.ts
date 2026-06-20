/**
 * The GateBackend DI interface.
 *
 * One interface covers both consumption paths:
 *   - hook path: evaluatePreToolUse + the pending/verified side-effect helpers
 *     the hook entrypoints call after emitting their decision.
 *   - server path: the step-up session tools, RBAC-coordinate validation, the
 *     tool-rule CRUD, and the backend MCP tool registration.
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
import type { CreatedStepupSession, CreateStepupArgs, GateDecision, MergedPattern, MergedToolRule, PendingState, PolicyBundleRefreshOutcome, PollStepupResult, StepupStateInspection, ToolCallInput, ToolRule, ToolRuleChanges, ToolRuleInput, ToolRuleMatch, VerifiedStepup, WaitStepupResult } from './types.js';
export interface GateBackend {
    evaluatePreToolUse(input: ToolCallInput): Promise<GateDecision>;
    /** Caller writes the pending record AFTER emitting deny (fail-safe order). */
    writePending(state: PendingState): void;
    consumeVerified(fp?: string): void;
    clearPending(fp?: string): void;
    firstActivePending(now?: number): PendingState | null;
    firstInFlightFpPending(now?: number): PendingState | null;
    readPending(fp?: string): PendingState | null;
    readVerified(fp?: string): VerifiedStepup | null;
    isExpired(state: PendingState, now?: number): boolean;
    sweepStepup(now?: number): void;
    /** Whether a Transcodes token is resolvable (session-start no-token notice). */
    hasToken(): boolean;
    /**
     * Fire-and-forget decision audit (Phase3 v2 H2). Call AFTER the decision
     * JSON is on stdout — never rejects, bounded by a sub-second timeout, and
     * a silent no-op for `pass` decisions or when no token is resolvable.
     */
    sendGateDecisionAudit(decision: GateDecision): Promise<void>;
    /**
     * TTL-gated policy bundle refresh (Phase3 v2 G2). Called from the
     * SessionStart-equivalent hooks AFTER their stdout emit and from MCP server
     * boot — never from PreToolUse (the hook critical path reads cache only).
     * Never rejects; a silent no-op when no token is resolvable, and a failed
     * fetch keeps the previous cache (last-known-good). Returns the outcome so
     * callers (e.g. the `refresh_rules` MCP tool) can report it honestly.
     */
    refreshPolicyBundle(): Promise<PolicyBundleRefreshOutcome>;
    createStepupSession(args: CreateStepupArgs): Promise<CreatedStepupSession>;
    pollStepupSession(sid: string): Promise<PollStepupResult>;
    pollStepupSessionWait(sid: string, options?: {
        maxWaitMs?: number;
        intervalMs?: number;
    }): Promise<WaitStepupResult>;
    inspectStepupState(): StepupStateInspection;
    findPendingBySid(sid: string): {
        fp?: string;
        pending: PendingState;
    } | null;
    writeVerified(v: VerifiedStepup, fp?: string): void;
    markVerified(sid: string): void;
    assertRbacCoordinate(resource: string, action: string): Promise<void>;
    isRbacCoordinateError(e: unknown): e is Error;
    loadMergedToolRules(): MergedToolRule[];
    /** System baseline + cached bundle bash rules (`type:'bash'`). */
    loadEffectivePatterns(): MergedPattern[];
    findFirstToolRule(toolName: string, rules: MergedToolRule[]): ToolRuleMatch | null;
    /**
     * Tool-rule writes (Phase 3 v2): these persist to the Transcodes backend as
     * project policy (`/v1/guard/rules`) and force-refresh the bundle cache — they
     * are async network calls, not local-file writes. No token / backend failure
     * throws a `ToolRuleValidationError` (caught via `isToolRuleValidationError`).
     */
    addToolRule(input: ToolRuleInput): Promise<ToolRule>;
    updateToolRule(id: string, changes: ToolRuleChanges): Promise<ToolRule>;
    removeToolRule(id: string): Promise<void>;
    isToolRuleValidationError(e: unknown): e is Error;
    registerBackendTools(server: McpServer): void;
}
