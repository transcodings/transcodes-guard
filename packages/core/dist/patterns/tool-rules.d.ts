import { type RbacAction } from './rbac.js';
export { GUARD_META_TOOL_NAMES, GUARD_TOOL_NAMES, } from './guard-tool-names.generated.js';
export type GuardMatcher = 'exact' | 'glob' | 'regex';
export declare const GUARD_PROVIDERS: readonly ["claude", "codex", "cursor", "antigravity", "web"];
export type GuardProvider = (typeof GUARD_PROVIDERS)[number];
export interface ToolRule {
    id: string;
    type: 'mcp' | 'bash';
    label: string;
    description: string;
    /** MCP wire name/glob, or Bash regex when `type` is `bash`. */
    name: string;
    matcher: GuardMatcher;
    /** Optional MCP host label — scopes matching to that host (absent ⇒ every host). */
    provider?: GuardProvider;
    /** Step-up RBAC verb — omitted when the rule only gates tool access. */
    action?: RbacAction;
    /** Step-up resource key — omitted when the rule only gates tool access. */
    resource?: string;
    /**
     * @deprecated Read by nothing (t3). It used to pick which side consumed the
     * local verified record; there is no local record now — the backend owns
     * verified state and the handler backstop claims an in-memory sid instead.
     * Kept in the shape so existing bundle rules and backend verdicts still parse;
     * do not branch on it.
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
/** Canonical registerTool / tool-rules prefix for built-in transcodes-guard MCP. */
export declare const TRANSCODES_GUARD_TOOL_PREFIX = "tc_";
/** Wire names emitted by host PreToolUse hooks for MCP tool calls. */
export declare function isMcpWireToolName(toolName: string): boolean;
/**
 * Built-in transcodes-guard MCP — PreToolUse skips /guard/evaluate.
 * Exact set membership only (no substring/prefix heuristics): bare
 * registered name, or host-namespaced form whose namespace AND tool part
 * both match. Anything else → not ours → gated (fail-safe).
 */
export declare function isGuardToolName(toolName: string): boolean;
export interface BuiltinExemptEntry {
    name: string;
    reason: string;
}
/** Per-provider builtin-exempt entries — exposed for tests/reporting only. */
export declare function builtinExemptEntries(provider: GuardProvider): readonly BuiltinExemptEntry[];
/**
 * Host built-in tool from the per-provider static allow list (grade ①
 * conversation/plan + ② workspace-read only — see toolgate t2 §2-c).
 * Exact, case-sensitive match; the lists are compiled into the bundle and
 * cannot be extended at runtime. Unknown host → NO exemption (fail-safe:
 * over-gate, never over-skip).
 */
export declare function isBuiltinExemptToolName(provider: GuardProvider | undefined, toolName: string): boolean;
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
/**
 * Reserved system rule ids from the JSON registry (now MCP-rule-free). The
 * derived protected-rule table was retired with the handler backstop (t10) —
 * step-up enforcement for built-in tools is backend-owned, so there are no
 * client rule ids left to shadow.
 */
export declare function systemToolRuleIds(): Set<string>;
