/**
 * Backend-403 → structured recovery translation for protected MCP tool
 * handlers.
 *
 * Enforcement is backend-owned: `StepUpSessionGuard` resolves RBAC and
 * accepts step-up via the coordinate verified cache
 * (`stepup:{project}:{member}:{resource}:{action}`), so the handler sends no
 * step-up header and re-checks nothing. The wrapper's only job is recovery
 * guidance, branched on the guard's machine-readable `errorCode`:
 *
 * - `STEP_UP_REQUIRED` (or absent — legacy backend) → the coordinate is
 *   unlockable: guide create → WebAuthn → poll → retry.
 * - `RBAC_DENIED` → permission level 0: step-up cannot unlock it, so guide
 *   the agent NOT to start an auth ceremony.
 * - `RBAC_UNRESOLVED` → the backend could not resolve the RBAC level
 *   (transient/misconfiguration): guide a plain retry, not auth.
 */
import type { ProtectedToolDefinition, ToolTextResult } from '@transcodes-guard/core/contract';
export declare function wrapProtectedTool(def: ProtectedToolDefinition): (args: never) => Promise<ToolTextResult>;
