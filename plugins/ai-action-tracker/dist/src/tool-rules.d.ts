export interface ToolRule {
    id: string;
    /** Exact tool_name match. Regex is intentionally not supported — keeps the
     * gate's scope explicit and auditable. */
    toolName: string;
    reason: string;
    /** Backend audit-log action identifier (e.g. "retire_member"). */
    stepupAction: string;
    /** Backend audit-log resource identifier (e.g. "ai-action-tracker:mcp:members"). */
    stepupResource: string;
}
export interface ToolRuleConfig {
    rules: ToolRule[];
}
export type ToolRuleSource = "system" | "user";
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
    stepupAction: string;
    stepupResource: string;
}
export declare function validateNewToolRule(input: ToolRuleInput): ToolRule;
export declare function addUserToolRule(input: ToolRuleInput): ToolRule;
export declare function updateUserToolRule(id: string, changes: {
    toolName?: string;
    reason?: string;
    stepupAction?: string;
    stepupResource?: string;
}): ToolRule;
export declare function removeUserToolRule(id: string): void;
