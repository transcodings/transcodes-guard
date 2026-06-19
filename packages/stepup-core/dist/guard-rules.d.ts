/**
 * Backend write flows for guard tool-rules (Phase 3 v2).
 */
import { type ToolRule, type ToolRuleChanges, type ToolRuleInput } from '@transcodes-guard/danger-patterns';
/** Full guard rule from `GET /guard/rules` (includes management fields). */
export type GuardRuleRecord = ToolRule & {
    status: 'active' | 'inactive';
    memberId?: string;
    createdAt?: string;
    updatedAt?: string;
    metadata?: Record<string, unknown> | null;
};
/** List every project guard rule (active + inactive) from the backend. */
export declare function listGuardRules(): Promise<GuardRuleRecord[]>;
export declare function addToolRule(input: ToolRuleInput): Promise<ToolRule>;
export declare function updateToolRule(id: string, changes: ToolRuleChanges): Promise<ToolRule>;
export declare function removeToolRule(id: string): Promise<void>;
