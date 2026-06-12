/**
 * Backend write flows for guard tool-rules (Phase 3 v2).
 *
 * Tool-rules are organization/project policy managed in the Transcodes backend
 * (Unit G, endpoint B-2: `POST/PUT/DELETE /v1/guard/rules`). The MCP write
 * tools (`add_tool_rule`/`update_tool_rule`/`remove_tool_rule`) and the CLI
 * dashboard route through here instead of a local file: validate client-side,
 * call the backend CRUD, then force-refresh the policy bundle cache so the
 * change is effective on the next PreToolUse hook.
 *
 * The per-user local rule file was retired — rules are now centrally managed
 * policy applied uniformly to every human/AI agent in the project. No token /
 * backend failure surfaces as `ToolRuleValidationError` so the MCP handlers and
 * the dashboard report a clean rejection (there is no local fallback).
 */
import { type ToolRule, type ToolRuleChanges, type ToolRuleInput } from '@transcodes-guard-private/danger-rules';
/**
 * Create a project tool-rule. Validates client-side (id/toolName/coordinate +
 * system-id reservation) before the round-trip; the backend re-validates.
 */
export declare function addToolRule(input: ToolRuleInput): Promise<ToolRule>;
/**
 * Update a project tool-rule (PUT = full replace). Partial `changes` are merged
 * onto the rule's current state read from the cached bundle, so an unspecified
 * field keeps its stored value. System rules are immutable.
 */
export declare function updateToolRule(id: string, changes: ToolRuleChanges): Promise<ToolRule>;
/** Delete a project tool-rule. System rules are immutable. */
export declare function removeToolRule(id: string): Promise<void>;
