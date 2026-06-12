/**
 * Tool-rule registry — MCP-call counterpart of danger-patterns.
 *
 * `danger-patterns.ts` matches Bash command strings via regex; this module
 * matches PreToolUse payloads where `tool_name` identifies an MCP tool that
 * must trigger step-up MFA.
 *
 * Phase 3 v2: rules are organization/project policy managed in the Transcodes
 * backend (Unit G). This module owns the **read/merge + validation** surface
 * only — the built-in system baseline merged with the cached project bundle.
 * Writes go to the backend (`@transcodes-guard-private/stepup-core`
 * `addToolRule`/`updateToolRule`/`removeToolRule`), never to a local file.
 */
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
     * Defaults per source in `loadMergedToolRules`: system=false, bundle=false. */
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
 * Layered merge (Phase3 v2 G3): built-in baseline → org/project policy bundle.
 * Same `id` in a later layer replaces the earlier rule (the replacement keeps
 * the original position so precedence inside a layer stays stable). The
 * per-user local layer was retired — rules are now centrally managed backend
 * policy applied uniformly to every human/AI agent in the project.
 *
 * `bundleRules` is the cached project bundle's `rules` array. Callers without a
 * bundle (no token / no cache) pass nothing and get the baseline only —
 * fail-closed matrix row 3.
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
/** Partial change set for an existing tool-rule (PUT semantics: an omitted
 * field keeps the stored value, resolved against the cached bundle). */
export interface ToolRuleChanges {
    toolName?: string;
    reason?: string;
    stepupAction?: string;
    stepupResource?: string;
    consume_in_hook?: boolean;
}
/**
 * Client-side validation shared by the backend write flows (fail fast before a
 * network round-trip; the backend re-validates). Enforces the id/toolName/
 * action/resource shape and reserves the system rule ids.
 */
export declare function validateNewToolRule(input: ToolRuleInput): ToolRule;
/** Resolve a partial change set against an existing rule into a full validated
 * rule (PUT body). System rules are immutable. */
export declare function mergeToolRuleChanges(existing: ToolRule, changes: ToolRuleChanges): ToolRule;
/** The system rule ids — reserved and immutable. */
export declare function systemToolRuleIds(): Set<string>;
