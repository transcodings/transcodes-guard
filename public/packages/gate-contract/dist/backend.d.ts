/**
 * The GateBackend DI interface.
 *
 * One interface covers both consumption paths:
 *   - hook path: evaluatePreToolUse + the pending/verified side-effect helpers
 *     the hook entrypoints call after emitting their decision.
 *   - server path: the step-up session tools, RBAC-coordinate validation, the
 *     tool-rule CRUD, and the backend MCP tool registration.
 *
 * The real implementation lives in `@transcodes-guard-private/gate-backend` and
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
import type { CreatedStepupSession, CreateStepupArgs, GateDecision, MergedToolRule, PendingState, PollStepupResult, StepupStateInspection, ToolCallInput, ToolRule, ToolRuleChanges, ToolRuleInput, ToolRuleMatch, VerifiedStepup, WaitStepupResult } from './types.js';
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
    findFirstToolRule(toolName: string, rules: MergedToolRule[]): ToolRuleMatch | null;
    addUserToolRule(input: ToolRuleInput): ToolRule;
    updateUserToolRule(id: string, changes: ToolRuleChanges): ToolRule;
    removeUserToolRule(id: string): void;
    getUserToolRulesPath(): string;
    isToolRuleValidationError(e: unknown): e is Error;
    registerBackendTools(server: McpServer): void;
}
