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
export type ToolRuleSource = 'system' | 'user';
export interface MergedToolRule extends ToolRule {
    source: ToolRuleSource;
}
export declare function getUserToolRulesPath(): string;
export declare function loadSystemToolRules(): ToolRuleConfig;
export declare function loadUserToolRules(): ToolRuleConfig;
export declare function saveUserToolRules(config: ToolRuleConfig): void;
export declare function userToolRulesFileExists(): boolean;
export declare function loadMergedToolRules(): MergedToolRule[];
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
