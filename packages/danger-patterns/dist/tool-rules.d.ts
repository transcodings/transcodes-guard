import { type RbacAction } from './rbac.js';
export type GuardMatcher = 'exact' | 'glob' | 'regex';
export declare const GUARD_PROVIDERS: readonly ["claude", "codex", "cursor", "antigravity"];
export type GuardProvider = (typeof GUARD_PROVIDERS)[number];
export interface ToolRule {
    id: string;
    type: 'mcp' | 'bash';
    label: string;
    description: string;
    /** MCP wire name/glob, or Bash regex when `type` is `bash`. */
    name: string;
    matcher: GuardMatcher;
    /** Optional MCP host label — stored for future use; does not affect matching today. */
    provider?: GuardProvider;
    /** Step-up RBAC verb — omitted when the rule only gates tool access. */
    action?: RbacAction;
    /** Step-up resource key — omitted when the rule only gates tool access. */
    resource?: string;
    /**
     * When true, the hook consumes the verified record (FP-keyed, single-shot).
     * When false, the MCP tool handler passes sid via X-Step-Up-Session-Id.
     * Default: `true` for bundle (project) rules, `false` for system rules.
     */
    consume_in_hook?: boolean;
}
export interface ToolRuleConfig {
    rules: ToolRule[];
}
export type ToolRuleSource = 'system' | 'bundle';
export interface MergedToolRule extends ToolRule {
    source: ToolRuleSource;
}
export declare function loadSystemToolRules(): ToolRuleConfig;
/**
 * Layered merge: built-in baseline → org/project policy bundle.
 * Same `id` in a later layer replaces the earlier rule.
 */
export declare function loadMergedToolRules(bundleRules?: ToolRule[]): MergedToolRule[];
export interface ToolRuleMatch {
    matched: MergedToolRule;
}
export declare function toolNameMatchesRule(toolName: string, rule: ToolRule): boolean;
/**
 * Map a host / provider string to the canonical rule `provider` slug.
 * Canonical values: claude | codex | cursor | antigravity.
 * Legacy alias `claude-code` → `claude` (old records only; host.ts sets `claude`).
 */
export declare function mapHostToProvider(host: string | undefined): GuardProvider | undefined;
/** Provider of the host this process runs under, read from the env var. */
export declare function currentHostProvider(): GuardProvider | undefined;
/**
 * Whether a rule applies to the given host. Fail-safe by design:
 *  - A rule WITHOUT `provider` (e.g. all 14 system baseline rules) applies to
 *    EVERY host — never weaken baseline protection.
 *  - A provider-scoped rule applies only on its own host.
 *  - When the host is unknown (`undefined`), every rule applies (fail-closed:
 *    we would rather over-gate than silently skip a rule).
 */
export declare function ruleAppliesToHost(rule: ToolRule, hostProvider?: GuardProvider | undefined): boolean;
export declare function findFirstToolRule(toolName: string, rules: MergedToolRule[], hostProvider?: GuardProvider | undefined): ToolRuleMatch | null;
/** Whether PreToolUse should consume the verified record for this MCP rule. */
export declare function mcpConsumesInHook(rule: MergedToolRule): boolean;
export declare class ToolRuleValidationError extends Error {
}
export interface ToolRuleInput {
    id: string;
    type?: 'mcp' | 'bash';
    label: string;
    description: string;
    name: string;
    matcher?: GuardMatcher;
    provider?: GuardProvider;
    action?: string;
    resource?: string;
    status?: 'active' | 'inactive';
    metadata?: Record<string, unknown>;
}
/** Partial change set for an existing tool-rule (PUT semantics). */
export interface ToolRuleChanges {
    type?: 'mcp' | 'bash';
    label?: string;
    description?: string;
    name?: string;
    matcher?: GuardMatcher;
    provider?: GuardProvider;
    action?: string;
    resource?: string;
    status?: 'active' | 'inactive';
    metadata?: Record<string, unknown>;
}
export declare function validateNewToolRule(input: ToolRuleInput): ToolRule;
export declare function mergeToolRuleChanges(existing: ToolRule, changes: ToolRuleChanges): ToolRule;
export declare function systemToolRuleIds(): Set<string>;
