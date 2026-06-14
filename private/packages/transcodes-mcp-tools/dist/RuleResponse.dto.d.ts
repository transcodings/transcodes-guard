import { type RuleMatcher, type RuleStatus, type RuleType } from '../types/rule.constants';
export declare class RuleMcpPayloadResponseDto {
    server: string;
    tool: string;
    matcher: RuleMatcher;
}
export declare class RuleBashPayloadResponseDto {
    pattern: string;
    matcher: RuleMatcher;
}
/** Response DTO for a member MCP/bash rule. */
export declare class RuleResponseDto {
    id: string;
    project_id: string;
    member_id: string;
    type: RuleType;
    label: string;
    status: RuleStatus;
    description?: string;
    resource?: string;
    action?: string;
    mcp?: RuleMcpPayloadResponseDto;
    bash?: RuleBashPayloadResponseDto;
    metadata?: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}
