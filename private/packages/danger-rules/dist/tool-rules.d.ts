import { type RbacAction } from '@transcodes-guard/danger-patterns';
export interface ToolRule {
    id: string;
    /** Exact tool_name match. Regex is intentionally not supported — keeps the
     * gate's scope explicit and auditable. */
    toolName: string;
    reason: string;
    /** RBAC CRUD action this rule maps onto (create/read/update/delete). Feeds
     * `createStepupSession({ action })` so the step-up audit log + the project's
     * RBAC permission matrix share coordinates. */
    stepupAction: RbacAction;
    /** RBAC resource key (e.g. "system"), validated against the live backend at
     * add time. Feeds `createStepupSession({ resource })`. */
    stepupResource: string;
    /** When true, the PreToolUse hook consumes the verified record itself on the
     * fast-path (Bash-like). When false, consume is deferred to the tool handler
     * via `withStepupVerifiedSid` (handler needs the sid for the backend header).
     * Defaults per source in `loadMergedToolRules`: system=false, user=true. */
    consume_in_hook?: boolean;
}
export interface ToolRuleConfig {
    rules: ToolRule[];
}
export type ToolRuleSource = 'system' | 'bundle' | 'user';
export interface MergedToolRule extends ToolRule {
    source: ToolRuleSource;
}
export declare function getUserToolRulesPath(): string;
export declare function loadSystemToolRules(): ToolRuleConfig;
export declare function loadUserToolRules(): ToolRuleConfig;
export declare function saveUserToolRules(config: ToolRuleConfig): void;
export declare function userToolRulesFileExists(): boolean;
/**
 * Layered merge (Phase3 v2 G3): built-in baseline → org policy bundle →
 * user rules. Same `id` in a later layer replaces the earlier rule (the
 * replacement keeps the original position so rule precedence inside a layer
 * stays stable); user rules win over everything — the pre-bundle user-rule
 * semantics are preserved unchanged.
 *
 * `bundleRules` is the cached org bundle's `rules` array (Unit G policy
 * bundle). Callers without a bundle (no token / no cache) pass nothing and
 * get the pre-G3 baseline+user behavior — fail-closed matrix row 3.
 */
export declare function loadMergedToolRules(bundleRules?: ToolRule[]): MergedToolRule[];
export interface ToolRuleMatch {
    matched: MergedToolRule;
}
export declare function findFirstToolRule(toolName: string, rules: MergedToolRule[]): ToolRuleMatch | null;
export declare class ToolRuleValidationError extends Error {
}
export interface ToolRuleInput {
    id: string;
    toolName: string;
    reason: string;
    /** Must be a CRUD action (create/read/update/delete). */
    stepupAction: string;
    /** RBAC resource key. Backend existence is validated by the caller (MCP
     * handler) before this runs — this layer only enforces non-empty. */
    stepupResource: string;
    consume_in_hook?: boolean;
}
export declare function validateNewToolRule(input: ToolRuleInput): ToolRule;
export declare function addUserToolRule(input: ToolRuleInput): ToolRule;
export declare function updateUserToolRule(id: string, changes: {
    toolName?: string;
    reason?: string;
    stepupAction?: string;
    stepupResource?: string;
    consume_in_hook?: boolean;
}): ToolRule;
export declare function removeUserToolRule(id: string): void;
