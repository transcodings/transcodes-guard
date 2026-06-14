import type { FindOptions, UpdateOptions } from 'mongodb';
import { ProjectMembersRepository } from '#/auth/repositories/project-members.repository';
import { ProjectRulesRepository } from '#/auth/repositories/project-rules.repository';
import type { ProjectRule } from '#/database/mongodb/entities/project-rule.entity';
import type { CreateRuleDto, DeleteRuleDto, UpdateRuleDto } from '../dtos';
import type { RuleResponseDto } from '../dtos/RuleResponse.dto';
import { type RuleType } from '../types/rule.constants';
/** CRUD for member-scoped MCP tool and bash command rules. */
export declare class RuleService {
    private readonly rules;
    private readonly members;
    constructor(rules: ProjectRulesRepository, members: ProjectMembersRepository);
    getRules(params: {
        project_id: string;
        member_id: string;
        type?: RuleType;
        status?: ProjectRule['status'];
    }, option?: FindOptions): Promise<RuleResponseDto[]>;
    getRule(params: {
        project_id: string;
        member_id: string;
        rule_id: string;
    }): Promise<RuleResponseDto>;
    createRule(body: CreateRuleDto): Promise<RuleResponseDto>;
    updateRule(params: {
        project_id: string;
        member_id: string;
        rule_id: string;
    }, body: UpdateRuleDto, option?: UpdateOptions): Promise<RuleResponseDto>;
    deleteRule(params: DeleteRuleDto & {
        rule_id: string;
    }): Promise<void>;
    private assertMemberInProject;
    private findOwnedRule;
    private static assertTypePayload;
    private static toRuleResponse;
}
