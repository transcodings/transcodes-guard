/**
 * The GateBackend DI interface.
 *
 * One interface covers both consumption paths:
 *   - hook path: evaluatePreToolUse + the token probe. Guard v3 hooks perform no
 *     step-up persistence, so there are no side-effect helpers here (t3).
 *   - server path: the step-up session tools, RBAC-coordinate validation, and
 *     the backend MCP tool registration.
 *
 * The real implementation lives in `@transcodes-guard/gate-backend` and
 * is registered via `setGateBackend()` at plugin bootstrap. The public side
 * (core/server + hooks) only ever calls `getGateBackend()`.
 *
 * Config-less by design: methods like `createStepupSession(args)` and
 * `assertRbacCoordinate(resource, action)` load the StepupConfig internally so
 * that `StepupConfig` (a backend-coupled type) never crosses into the public
 * surface. Error classes are likewise hidden behind `is*Error(e)` predicates
 * (instanceof would require exporting the class).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CreatedStepupSession,
  CreateStepupArgs,
  GateDecision,
  PollStepupResult,
  StepupStateInspection,
  ToolCallInput,
  WaitStepupResult,
} from './types.js';

export interface GateBackend {
  // ── hook path ─────────────────────────────────────────────────────────
  evaluatePreToolUse(input: ToolCallInput): Promise<GateDecision>;
  /** Whether a Transcodes token is resolvable (session-start no-token notice). */
  hasToken(): boolean;

  // ── server path: step-up session (config loaded internally) ────────────
  createStepupSession(args: CreateStepupArgs): Promise<CreatedStepupSession>;
  pollStepupSession(sid: string): Promise<PollStepupResult>;
  /** Single poll by MAT + resource/action coordinate. */
  pollStepupByCoordinate(coordinate: {
    resource: string;
    action: string;
  }): Promise<PollStepupResult & { sid?: string }>;
  /**
   * Wait until verified/rejected/timeout.
   * Pass a sid string, or `{ resource, action }` (optional sid) for coordinate poll.
   */
  pollStepupSessionWait(
    target:
      | string
      | {
          sid?: string | undefined;
          resource?: string | undefined;
          action?: string | undefined;
        },
    options?: {
      maxWaitMs?: number | undefined;
      intervalMs?: number | undefined;
    },
  ): Promise<WaitStepupResult>;
  inspectStepupState(): StepupStateInspection;
  /** Record a backend-verified sid in the server's in-memory verified set so the
   * `execProtectedTool` handler backstop can consume it (single-shot). Called
   * by the poll tools on `verified`.
   */
  markStepupVerified(sid: string): void;

  // ── server path: RBAC coordinate validation (config loaded internally) ──
  assertRbacCoordinate(resource: string, action: string): Promise<void>;
  isRbacCoordinateError(e: unknown): e is Error;

  // ── server path: backend-coupled MCP tools (member/rbac/passcode/...) ───
  registerBackendTools(server: McpServer): void;
}
