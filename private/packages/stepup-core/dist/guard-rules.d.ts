/**
 * Backend write flows for guard tool-rules (Phase 3 v2).
 */
import { type ToolRule, type ToolRuleChanges, type ToolRuleInput } from '@transcodes-guard-private/danger-rules';
export declare function addToolRule(input: ToolRuleInput): Promise<ToolRule>;
export declare function updateToolRule(id: string, changes: ToolRuleChanges): Promise<ToolRule>;
export declare function removeToolRule(id: string): Promise<void>;
