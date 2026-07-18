/**
 * 403 → STEP_UP_REQUIRED translation for protected MCP tool handlers.
 *
 * Enforcement is backend-owned: `StepUpSessionGuard` resolves RBAC and
 * accepts step-up via the coordinate verified cache
 * (`stepup:{project}:{member}:{resource}:{action}`), so the handler sends no
 * step-up header and re-checks nothing (t10 — the `execProtectedTool`
 * backstop and its in-memory verified set are gone). The wrapper's only job
 * is recovery guidance: when the backend answers 403, translate it into a
 * structured `STEP_UP_REQUIRED` result carrying the definition's `stepUp`
 * coordinate so the agent can drive create → WebAuthn → poll → retry.
 */
import type { ProtectedToolDefinition, ToolTextResult } from '@transcodes-guard/core/contract';
export declare function wrapProtectedTool(def: ProtectedToolDefinition): (args: never) => Promise<ToolTextResult>;
