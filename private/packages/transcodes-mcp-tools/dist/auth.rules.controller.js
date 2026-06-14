var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Controller, Delete, Get, Post, Put, } from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiOperation, ApiParam, ApiQuery, ApiTags, } from '@nestjs/swagger';
import { ApiArrayNormalizedResponse } from '#/global/decorators/normalized-response.swagger';
import { CreateRuleDto, DeleteRuleDto, RuleResponseDto, UpdateRuleDto, } from './dtos';
import { GetRuleParams, GetRuleQueryParams, GetRulesParams, } from './params/auth.rules.params';
/**
 * MCP agent tool and bash command rule management.
 *
 * Default auth: global `AuthGuard` (`firebase` | `apitoken`).
 */
let RulesController = (() => {
    let _classDecorators = [ApiTags('Rule Management'), ApiExtraModels(GetRuleParams, GetRuleQueryParams), Controller('auth')];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _instanceExtraInitializers = [];
    let _getRules_decorators;
    let _getRule_decorators;
    let _createRule_decorators;
    let _updateRule_decorators;
    let _deleteRule_decorators;
    var RulesController = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _getRules_decorators = [ApiOperation({
                    summary: 'List member rules',
                    description: 'List MCP tool or bash rules for a project member. Optional filters: type, status.',
                }), ApiQuery({ type: GetRulesParams }), ApiArrayNormalizedResponse(RuleResponseDto), Get('rule')];
            _getRule_decorators = [ApiOperation({ summary: 'Get rule by id' }), ApiParam({ name: 'rule_id', description: 'Rule ID' }), ApiQuery({ name: 'project_id', type: String, required: true }), ApiQuery({ name: 'member_id', type: String, required: true }), ApiArrayNormalizedResponse(RuleResponseDto), Get('rule/:rule_id')];
            _createRule_decorators = [ApiOperation({
                    summary: 'Create rule',
                    description: 'Create an MCP tool rule (`type=mcp`) or bash rule (`type=bash`).',
                }), ApiBody({ type: CreateRuleDto }), ApiArrayNormalizedResponse(RuleResponseDto), Post('rule')];
            _updateRule_decorators = [ApiOperation({
                    summary: 'Update rule',
                    description: 'Patch rule fields. `type` cannot be changed after creation.',
                }), ApiParam({ name: 'rule_id', description: 'Rule ID' }), ApiBody({ type: UpdateRuleDto }), ApiArrayNormalizedResponse(RuleResponseDto), Put('rule/:rule_id')];
            _deleteRule_decorators = [ApiOperation({ summary: 'Delete rule' }), ApiParam({ name: 'rule_id', description: 'Rule ID' }), ApiBody({ type: DeleteRuleDto }), Delete('rule/:rule_id')];
            __esDecorate(this, null, _getRules_decorators, { kind: "method", name: "getRules", static: false, private: false, access: { has: obj => "getRules" in obj, get: obj => obj.getRules }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getRule_decorators, { kind: "method", name: "getRule", static: false, private: false, access: { has: obj => "getRule" in obj, get: obj => obj.getRule }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _createRule_decorators, { kind: "method", name: "createRule", static: false, private: false, access: { has: obj => "createRule" in obj, get: obj => obj.createRule }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateRule_decorators, { kind: "method", name: "updateRule", static: false, private: false, access: { has: obj => "updateRule" in obj, get: obj => obj.updateRule }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _deleteRule_decorators, { kind: "method", name: "deleteRule", static: false, private: false, access: { has: obj => "deleteRule" in obj, get: obj => obj.deleteRule }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            RulesController = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        ruleService = __runInitializers(this, _instanceExtraInitializers);
        constructor(ruleService) {
            this.ruleService = ruleService;
        }
        async getRules(params) {
            return this.ruleService.getRules(params);
        }
        async getRule(pathParams, query) {
            return this.ruleService.getRule({
                project_id: query.project_id,
                member_id: query.member_id,
                rule_id: pathParams.rule_id,
            });
        }
        async createRule(body) {
            return this.ruleService.createRule(body);
        }
        async updateRule(rule_id, body) {
            return this.ruleService.updateRule({
                project_id: body.project_id,
                member_id: body.member_id,
                rule_id,
            }, body);
        }
        async deleteRule(rule_id, body) {
            await this.ruleService.deleteRule({ ...body, rule_id });
        }
    };
    return RulesController = _classThis;
})();
export { RulesController };
//# sourceMappingURL=auth.rules.controller.js.map