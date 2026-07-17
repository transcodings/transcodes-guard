import type { RbacAction } from './rbac.js';
/** Every registered built-in transcodes-guard MCP tool name (bare form). */
export declare const GUARD_TOOL_NAMES: ReadonlySet<string>;
/**
 * Step-up infrastructure (meta) tools — systemically required for the
 * step-up recovery loop. Must mirror the backend `guard.meta-tools.ts`
 * exactly; the drift alarm is packages/core/test/meta-tool-names.test.ts.
 */
export declare const GUARD_META_TOOL_NAMES: ReadonlySet<string>;
/** System step-up rule derived from a `stepUp` declaration. */
export interface GuardProtectedToolRule {
    id: string;
    name: string;
    label: string;
    description: string;
    action: RbacAction;
    resource: string;
}
/**
 * Step-up coordinates of every protected tool, in registration order —
 * the system MCP rule table, derived from the definition data.
 */
export declare const GUARD_PROTECTED_TOOL_RULES: readonly GuardProtectedToolRule[];
