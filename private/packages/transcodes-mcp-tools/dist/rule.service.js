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
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
import { BadRequestException, Injectable, NotFoundException, } from '@nestjs/common';
import { toObjectId, toPublicId } from '#/utils/converter';
import { RULE_STATUS, RULE_TYPE } from '../types/rule.constants';
/** CRUD for member-scoped MCP tool and bash command rules. */
let RuleService = (() => {
    let _classDecorators = [Injectable()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var RuleService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            RuleService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        rules;
        members;
        constructor(rules, members) {
            this.rules = rules;
            this.members = members;
        }
        async getRules(params, option) {
            await this.assertMemberInProject(params);
            const filter = {
                _project_id: toObjectId(params.project_id),
                _member_id: toObjectId(params.member_id),
            };
            if (params.type)
                filter.type = params.type;
            if (params.status)
                filter.status = params.status;
            const docs = await this.rules.find(filter, {
                ...option,
                sort: { created_at: -1 },
            });
            return docs.map((doc) => RuleService.toRuleResponse(doc, params.project_id, params.member_id));
        }
        async getRule(params) {
            const doc = await this.findOwnedRule(params);
            return RuleService.toRuleResponse(doc, params.project_id, params.member_id);
        }
        async createRule(body) {
            await this.assertMemberInProject(body);
            RuleService.assertTypePayload(body.type, body.mcp, body.bash);
            const now = new Date();
            const insertDoc = {
                _project_id: toObjectId(body.project_id),
                _member_id: toObjectId(body.member_id),
                type: body.type,
                label: body.label,
                description: body.description ?? null,
                status: body.status ?? RULE_STATUS.PENDING,
                resource: body.resource ?? null,
                action: body.action ?? null,
                mcp: body.type === RULE_TYPE.MCP ? (body.mcp ?? null) : null,
                bash: body.type === RULE_TYPE.BASH ? (body.bash ?? null) : null,
                metadata: body.metadata ?? null,
                created_at: now,
                updated_at: now,
            };
            const inserted = await this.rules.insertOne(insertDoc);
            return RuleService.toRuleResponse(inserted, body.project_id, body.member_id);
        }
        async updateRule(params, body, option) {
            const doc = await this.findOwnedRule(params);
            if (body.mcp && doc.type !== RULE_TYPE.MCP) {
                throw new BadRequestException('Cannot set mcp payload on a bash rule.');
            }
            if (body.bash && doc.type !== RULE_TYPE.BASH) {
                throw new BadRequestException('Cannot set bash payload on an mcp rule.');
            }
            const updatePayload = {
                updated_at: new Date(),
            };
            if (body.label !== undefined)
                updatePayload.label = body.label;
            if (body.description !== undefined) {
                updatePayload.description = body.description;
            }
            if (body.status !== undefined)
                updatePayload.status = body.status;
            if (body.resource !== undefined)
                updatePayload.resource = body.resource;
            if (body.action !== undefined)
                updatePayload.action = body.action;
            if (body.metadata !== undefined)
                updatePayload.metadata = body.metadata;
            if (body.mcp !== undefined)
                updatePayload.mcp = body.mcp;
            if (body.bash !== undefined)
                updatePayload.bash = body.bash;
            await this.rules.updateOne({ _id: doc._id }, { $set: updatePayload }, option);
            const merged = { ...doc, ...updatePayload };
            return RuleService.toRuleResponse(merged, params.project_id, params.member_id);
        }
        async deleteRule(params) {
            const doc = await this.findOwnedRule(params);
            await this.rules.deleteOne({ _id: doc._id });
        }
        async assertMemberInProject(params) {
            const member = await this.members.findOne({
                _project_id: toObjectId(params.project_id),
                _id: toObjectId(params.member_id),
            });
            if (!member) {
                throw new NotFoundException(`Member with id '${params.member_id}' does not exist in project '${params.project_id}'.`);
            }
        }
        async findOwnedRule(params) {
            await this.assertMemberInProject(params);
            const doc = await this.rules.findOne({
                _id: toObjectId(params.rule_id),
                _project_id: toObjectId(params.project_id),
                _member_id: toObjectId(params.member_id),
            });
            if (!doc) {
                throw new NotFoundException(`Rule with id '${params.rule_id}' not found.`);
            }
            return doc;
        }
        static assertTypePayload(type, mcp, bash) {
            if (type === RULE_TYPE.MCP && !mcp) {
                throw new BadRequestException('mcp payload is required when type is mcp.');
            }
            if (type === RULE_TYPE.BASH && !bash) {
                throw new BadRequestException('bash payload is required when type is bash.');
            }
            if (type === RULE_TYPE.MCP && bash) {
                throw new BadRequestException('bash payload must not be set when type is mcp.');
            }
            if (type === RULE_TYPE.BASH && mcp) {
                throw new BadRequestException('mcp payload must not be set when type is bash.');
            }
        }
        static toRuleResponse(doc, project_id, member_id) {
            const { _id, _project_id: _pid, _member_id: _mid, created_at, updated_at, description, resource, action, metadata, mcp, bash, ...rest } = doc;
            return {
                ...rest,
                id: toPublicId(_id),
                project_id,
                member_id,
                description: description ?? undefined,
                resource: resource ?? undefined,
                action: action ?? undefined,
                metadata: metadata ?? undefined,
                mcp: mcp ?? undefined,
                bash: bash ?? undefined,
                created_at,
                updated_at,
            };
        }
    };
    return RuleService = _classThis;
})();
export { RuleService };
//# sourceMappingURL=rule.service.js.map