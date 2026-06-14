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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RULE_MATCHERS, RULE_STATUSES, RULE_TYPES, } from '../types/rule.constants';
let RuleMcpPayloadResponseDto = (() => {
    let _server_decorators;
    let _server_initializers = [];
    let _server_extraInitializers = [];
    let _tool_decorators;
    let _tool_initializers = [];
    let _tool_extraInitializers = [];
    let _matcher_decorators;
    let _matcher_initializers = [];
    let _matcher_extraInitializers = [];
    return class RuleMcpPayloadResponseDto {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _server_decorators = [ApiProperty()];
            _tool_decorators = [ApiProperty()];
            _matcher_decorators = [ApiProperty({ enum: RULE_MATCHERS })];
            __esDecorate(null, null, _server_decorators, { kind: "field", name: "server", static: false, private: false, access: { has: obj => "server" in obj, get: obj => obj.server, set: (obj, value) => { obj.server = value; } }, metadata: _metadata }, _server_initializers, _server_extraInitializers);
            __esDecorate(null, null, _tool_decorators, { kind: "field", name: "tool", static: false, private: false, access: { has: obj => "tool" in obj, get: obj => obj.tool, set: (obj, value) => { obj.tool = value; } }, metadata: _metadata }, _tool_initializers, _tool_extraInitializers);
            __esDecorate(null, null, _matcher_decorators, { kind: "field", name: "matcher", static: false, private: false, access: { has: obj => "matcher" in obj, get: obj => obj.matcher, set: (obj, value) => { obj.matcher = value; } }, metadata: _metadata }, _matcher_initializers, _matcher_extraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        server = __runInitializers(this, _server_initializers, void 0);
        tool = (__runInitializers(this, _server_extraInitializers), __runInitializers(this, _tool_initializers, void 0));
        matcher = (__runInitializers(this, _tool_extraInitializers), __runInitializers(this, _matcher_initializers, void 0));
        constructor() {
            __runInitializers(this, _matcher_extraInitializers);
        }
    };
})();
export { RuleMcpPayloadResponseDto };
let RuleBashPayloadResponseDto = (() => {
    let _pattern_decorators;
    let _pattern_initializers = [];
    let _pattern_extraInitializers = [];
    let _matcher_decorators;
    let _matcher_initializers = [];
    let _matcher_extraInitializers = [];
    return class RuleBashPayloadResponseDto {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _pattern_decorators = [ApiProperty()];
            _matcher_decorators = [ApiProperty({ enum: RULE_MATCHERS })];
            __esDecorate(null, null, _pattern_decorators, { kind: "field", name: "pattern", static: false, private: false, access: { has: obj => "pattern" in obj, get: obj => obj.pattern, set: (obj, value) => { obj.pattern = value; } }, metadata: _metadata }, _pattern_initializers, _pattern_extraInitializers);
            __esDecorate(null, null, _matcher_decorators, { kind: "field", name: "matcher", static: false, private: false, access: { has: obj => "matcher" in obj, get: obj => obj.matcher, set: (obj, value) => { obj.matcher = value; } }, metadata: _metadata }, _matcher_initializers, _matcher_extraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        pattern = __runInitializers(this, _pattern_initializers, void 0);
        matcher = (__runInitializers(this, _pattern_extraInitializers), __runInitializers(this, _matcher_initializers, void 0));
        constructor() {
            __runInitializers(this, _matcher_extraInitializers);
        }
    };
})();
export { RuleBashPayloadResponseDto };
/** Response DTO for a member MCP/bash rule. */
let RuleResponseDto = (() => {
    let _id_decorators;
    let _id_initializers = [];
    let _id_extraInitializers = [];
    let _project_id_decorators;
    let _project_id_initializers = [];
    let _project_id_extraInitializers = [];
    let _member_id_decorators;
    let _member_id_initializers = [];
    let _member_id_extraInitializers = [];
    let _type_decorators;
    let _type_initializers = [];
    let _type_extraInitializers = [];
    let _label_decorators;
    let _label_initializers = [];
    let _label_extraInitializers = [];
    let _status_decorators;
    let _status_initializers = [];
    let _status_extraInitializers = [];
    let _description_decorators;
    let _description_initializers = [];
    let _description_extraInitializers = [];
    let _resource_decorators;
    let _resource_initializers = [];
    let _resource_extraInitializers = [];
    let _action_decorators;
    let _action_initializers = [];
    let _action_extraInitializers = [];
    let _mcp_decorators;
    let _mcp_initializers = [];
    let _mcp_extraInitializers = [];
    let _bash_decorators;
    let _bash_initializers = [];
    let _bash_extraInitializers = [];
    let _metadata_decorators;
    let _metadata_initializers = [];
    let _metadata_extraInitializers = [];
    let _created_at_decorators;
    let _created_at_initializers = [];
    let _created_at_extraInitializers = [];
    let _updated_at_decorators;
    let _updated_at_initializers = [];
    let _updated_at_extraInitializers = [];
    return class RuleResponseDto {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _id_decorators = [ApiProperty({ example: 'AbCd1234EfGh5678' })];
            _project_id_decorators = [ApiProperty({ example: 'project-1234' })];
            _member_id_decorators = [ApiProperty({ example: 'member-5678' })];
            _type_decorators = [ApiProperty({ enum: RULE_TYPES })];
            _label_decorators = [ApiProperty()];
            _status_decorators = [ApiProperty({ enum: RULE_STATUSES })];
            _description_decorators = [ApiPropertyOptional()];
            _resource_decorators = [ApiPropertyOptional({ example: 'system' })];
            _action_decorators = [ApiPropertyOptional({ example: 'create' })];
            _mcp_decorators = [ApiPropertyOptional({ type: RuleMcpPayloadResponseDto })];
            _bash_decorators = [ApiPropertyOptional({ type: RuleBashPayloadResponseDto })];
            _metadata_decorators = [ApiPropertyOptional({ type: 'object', additionalProperties: true })];
            _created_at_decorators = [ApiProperty()];
            _updated_at_decorators = [ApiProperty()];
            __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: obj => "id" in obj, get: obj => obj.id, set: (obj, value) => { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
            __esDecorate(null, null, _project_id_decorators, { kind: "field", name: "project_id", static: false, private: false, access: { has: obj => "project_id" in obj, get: obj => obj.project_id, set: (obj, value) => { obj.project_id = value; } }, metadata: _metadata }, _project_id_initializers, _project_id_extraInitializers);
            __esDecorate(null, null, _member_id_decorators, { kind: "field", name: "member_id", static: false, private: false, access: { has: obj => "member_id" in obj, get: obj => obj.member_id, set: (obj, value) => { obj.member_id = value; } }, metadata: _metadata }, _member_id_initializers, _member_id_extraInitializers);
            __esDecorate(null, null, _type_decorators, { kind: "field", name: "type", static: false, private: false, access: { has: obj => "type" in obj, get: obj => obj.type, set: (obj, value) => { obj.type = value; } }, metadata: _metadata }, _type_initializers, _type_extraInitializers);
            __esDecorate(null, null, _label_decorators, { kind: "field", name: "label", static: false, private: false, access: { has: obj => "label" in obj, get: obj => obj.label, set: (obj, value) => { obj.label = value; } }, metadata: _metadata }, _label_initializers, _label_extraInitializers);
            __esDecorate(null, null, _status_decorators, { kind: "field", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status, set: (obj, value) => { obj.status = value; } }, metadata: _metadata }, _status_initializers, _status_extraInitializers);
            __esDecorate(null, null, _description_decorators, { kind: "field", name: "description", static: false, private: false, access: { has: obj => "description" in obj, get: obj => obj.description, set: (obj, value) => { obj.description = value; } }, metadata: _metadata }, _description_initializers, _description_extraInitializers);
            __esDecorate(null, null, _resource_decorators, { kind: "field", name: "resource", static: false, private: false, access: { has: obj => "resource" in obj, get: obj => obj.resource, set: (obj, value) => { obj.resource = value; } }, metadata: _metadata }, _resource_initializers, _resource_extraInitializers);
            __esDecorate(null, null, _action_decorators, { kind: "field", name: "action", static: false, private: false, access: { has: obj => "action" in obj, get: obj => obj.action, set: (obj, value) => { obj.action = value; } }, metadata: _metadata }, _action_initializers, _action_extraInitializers);
            __esDecorate(null, null, _mcp_decorators, { kind: "field", name: "mcp", static: false, private: false, access: { has: obj => "mcp" in obj, get: obj => obj.mcp, set: (obj, value) => { obj.mcp = value; } }, metadata: _metadata }, _mcp_initializers, _mcp_extraInitializers);
            __esDecorate(null, null, _bash_decorators, { kind: "field", name: "bash", static: false, private: false, access: { has: obj => "bash" in obj, get: obj => obj.bash, set: (obj, value) => { obj.bash = value; } }, metadata: _metadata }, _bash_initializers, _bash_extraInitializers);
            __esDecorate(null, null, _metadata_decorators, { kind: "field", name: "metadata", static: false, private: false, access: { has: obj => "metadata" in obj, get: obj => obj.metadata, set: (obj, value) => { obj.metadata = value; } }, metadata: _metadata }, _metadata_initializers, _metadata_extraInitializers);
            __esDecorate(null, null, _created_at_decorators, { kind: "field", name: "created_at", static: false, private: false, access: { has: obj => "created_at" in obj, get: obj => obj.created_at, set: (obj, value) => { obj.created_at = value; } }, metadata: _metadata }, _created_at_initializers, _created_at_extraInitializers);
            __esDecorate(null, null, _updated_at_decorators, { kind: "field", name: "updated_at", static: false, private: false, access: { has: obj => "updated_at" in obj, get: obj => obj.updated_at, set: (obj, value) => { obj.updated_at = value; } }, metadata: _metadata }, _updated_at_initializers, _updated_at_extraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        id = __runInitializers(this, _id_initializers, void 0);
        project_id = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _project_id_initializers, void 0));
        member_id = (__runInitializers(this, _project_id_extraInitializers), __runInitializers(this, _member_id_initializers, void 0));
        type = (__runInitializers(this, _member_id_extraInitializers), __runInitializers(this, _type_initializers, void 0));
        label = (__runInitializers(this, _type_extraInitializers), __runInitializers(this, _label_initializers, void 0));
        status = (__runInitializers(this, _label_extraInitializers), __runInitializers(this, _status_initializers, void 0));
        description = (__runInitializers(this, _status_extraInitializers), __runInitializers(this, _description_initializers, void 0));
        resource = (__runInitializers(this, _description_extraInitializers), __runInitializers(this, _resource_initializers, void 0));
        action = (__runInitializers(this, _resource_extraInitializers), __runInitializers(this, _action_initializers, void 0));
        mcp = (__runInitializers(this, _action_extraInitializers), __runInitializers(this, _mcp_initializers, void 0));
        bash = (__runInitializers(this, _mcp_extraInitializers), __runInitializers(this, _bash_initializers, void 0));
        metadata = (__runInitializers(this, _bash_extraInitializers), __runInitializers(this, _metadata_initializers, void 0));
        created_at = (__runInitializers(this, _metadata_extraInitializers), __runInitializers(this, _created_at_initializers, void 0));
        updated_at = (__runInitializers(this, _created_at_extraInitializers), __runInitializers(this, _updated_at_initializers, void 0));
        constructor() {
            __runInitializers(this, _updated_at_extraInitializers);
        }
    };
})();
export { RuleResponseDto };
//# sourceMappingURL=RuleResponse.dto.js.map