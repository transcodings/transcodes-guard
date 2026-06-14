import { type RuleStatus } from '../types/rule.constants';
import { RuleBashPayloadDto } from './RuleBashPayload.dto';
import { RuleMcpPayloadDto } from './RuleMcpPayload.dto';
/** Request DTO for patching an existing rule. `type` cannot be changed. */
export declare class UpdateRuleDto {
    project_id: string;
    member_id: string;
    label?: string;
    status?: RuleStatus;
    resource?: string;
    action?: string;
    description?: string;
    mcp?: RuleMcpPayloadDto;
    bash?: RuleBashPayloadDto;
    metadata?: Record<string, unknown>;
}
