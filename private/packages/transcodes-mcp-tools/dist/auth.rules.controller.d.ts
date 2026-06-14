import { CreateRuleDto, DeleteRuleDto, RuleResponseDto, UpdateRuleDto } from './dtos';
import { RuleService } from './models/rule.service';
import { GetRuleParams, GetRuleQueryParams, GetRulesParams } from './params/auth.rules.params';
/**
 * MCP agent tool and bash command rule management.
 *
 * Default auth: global `AuthGuard` (`firebase` | `apitoken`).
 */
export declare class RulesController {
    private readonly ruleService;
    constructor(ruleService: RuleService);
    getRules(params: GetRulesParams): Promise<RuleResponseDto[]>;
    getRule(pathParams: GetRuleParams, query: GetRuleQueryParams): Promise<RuleResponseDto>;
    createRule(body: CreateRuleDto): Promise<RuleResponseDto>;
    updateRule(rule_id: string, body: UpdateRuleDto): Promise<RuleResponseDto>;
    deleteRule(rule_id: string, body: DeleteRuleDto): Promise<void>;
}
