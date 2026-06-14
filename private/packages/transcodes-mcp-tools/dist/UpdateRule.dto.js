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
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateNested, } from 'class-validator';
import { RoleCrudAction } from '../types/role-permissions.types';
import { RULE_STATUSES } from '../types/rule.constants';
import { RuleBashPayloadDto } from './RuleBashPayload.dto';
import { RuleMcpPayloadDto } from './RuleMcpPayload.dto';
/** Request DTO for patching an existing rule. `type` cannot be changed. */
let UpdateRuleDto = (() => {
    let _project_id_decorators;
    let _project_id_initializers = [];
    let _project_id_extraInitializers = [];
    let _member_id_decorators;
    let _member_id_initializers = [];
    let _member_id_extraInitializers = [];
    let _label_decorators;
    let _label_initializers = [];
    let _label_extraInitializers = [];
    let _status_decorators;
    let _status_initializers = [];
    let _status_extraInitializers = [];
    let _resource_decorators;
    let _resource_initializers = [];
    let _resource_extraInitializers = [];
    let _action_decorators;
    let _action_initializers = [];
    let _action_extraInitializers = [];
    let _description_decorators;
    let _description_initializers = [];
    let _description_extraInitializers = [];
    let _mcp_decorators;
    let _mcp_initializers = [];
    let _mcp_extraInitializers = [];
    let _bash_decorators;
    let _bash_initializers = [];
    let _bash_extraInitializers = [];
    let _metadata_decorators;
    let _metadata_initializers = [];
    let _metadata_extraInitializers = [];
    return class UpdateRuleDto {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _project_id_decorators = [ApiProperty({ example: 'project-1234' }), IsString(), IsNotEmpty()];
            _member_id_decorators = [ApiProperty({ example: 'member-5678' }), IsString(), IsNotEmpty()];
            _label_decorators = [ApiPropertyOptional({ example: 'Updated label' }), IsOptional(), IsString(), MaxLength(200)];
            _status_decorators = [ApiPropertyOptional({ enum: RULE_STATUSES }), IsOptional(), IsIn(RULE_STATUSES)];
            _resource_decorators = [ApiPropertyOptional({ example: 'system' }), IsOptional(), IsString(), MaxLength(100)];
            _action_decorators = [ApiPropertyOptional({ enum: Object.values(RoleCrudAction) }), IsOptional(), IsIn(Object.values(RoleCrudAction))];
            _description_decorators = [ApiPropertyOptional(), IsOptional(), IsString(), MaxLength(500)];
            _mcp_decorators = [ApiPropertyOptional({ type: RuleMcpPayloadDto }), IsOptional(), ValidateNested(), Type(() => RuleMcpPayloadDto)];
            _bash_decorators = [ApiPropertyOptional({ type: RuleBashPayloadDto }), IsOptional(), ValidateNested(), Type(() => RuleBashPayloadDto)];
            _metadata_decorators = [ApiPropertyOptional({ type: 'object', additionalProperties: true }), IsOptional(), IsObject()];
            __esDecorate(null, null, _project_id_decorators, { kind: "field", name: "project_id", static: false, private: false, access: { has: obj => "project_id" in obj, get: obj => obj.project_id, set: (obj, value) => { obj.project_id = value; } }, metadata: _metadata }, _project_id_initializers, _project_id_extraInitializers);
            __esDecorate(null, null, _member_id_decorators, { kind: "field", name: "member_id", static: false, private: false, access: { has: obj => "member_id" in obj, get: obj => obj.member_id, set: (obj, value) => { obj.member_id = value; } }, metadata: _metadata }, _member_id_initializers, _member_id_extraInitializers);
            __esDecorate(null, null, _label_decorators, { kind: "field", name: "label", static: false, private: false, access: { has: obj => "label" in obj, get: obj => obj.label, set: (obj, value) => { obj.label = value; } }, metadata: _metadata }, _label_initializers, _label_extraInitializers);
            __esDecorate(null, null, _status_decorators, { kind: "field", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status, set: (obj, value) => { obj.status = value; } }, metadata: _metadata }, _status_initializers, _status_extraInitializers);
            __esDecorate(null, null, _resource_decorators, { kind: "field", name: "resource", static: false, private: false, access: { has: obj => "resource" in obj, get: obj => obj.resource, set: (obj, value) => { obj.resource = value; } }, metadata: _metadata }, _resource_initializers, _resource_extraInitializers);
            __esDecorate(null, null, _action_decorators, { kind: "field", name: "action", static: false, private: false, access: { has: obj => "action" in obj, get: obj => obj.action, set: (obj, value) => { obj.action = value; } }, metadata: _metadata }, _action_initializers, _action_extraInitializers);
            __esDecorate(null, null, _description_decorators, { kind: "field", name: "description", static: false, private: false, access: { has: obj => "description" in obj, get: obj => obj.description, set: (obj, value) => { obj.description = value; } }, metadata: _metadata }, _description_initializers, _description_extraInitializers);
            __esDecorate(null, null, _mcp_decorators, { kind: "field", name: "mcp", static: false, private: false, access: { has: obj => "mcp" in obj, get: obj => obj.mcp, set: (obj, value) => { obj.mcp = value; } }, metadata: _metadata }, _mcp_initializers, _mcp_extraInitializers);
            __esDecorate(null, null, _bash_decorators, { kind: "field", name: "bash", static: false, private: false, access: { has: obj => "bash" in obj, get: obj => obj.bash, set: (obj, value) => { obj.bash = value; } }, metadata: _metadata }, _bash_initializers, _bash_extraInitializers);
            __esDecorate(null, null, _metadata_decorators, { kind: "field", name: "metadata", static: false, private: false, access: { has: obj => "metadata" in obj, get: obj => obj.metadata, set: (obj, value) => { obj.metadata = value; } }, metadata: _metadata }, _metadata_initializers, _metadata_extraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        project_id = __runInitializers(this, _project_id_initializers, void 0);
        member_id = (__runInitializers(this, _project_id_extraInitializers), __runInitializers(this, _member_id_initializers, void 0));
        label = (__runInitializers(this, _member_id_extraInitializers), __runInitializers(this, _label_initializers, void 0));
        status = (__runInitializers(this, _label_extraInitializers), __runInitializers(this, _status_initializers, void 0));
        resource = (__runInitializers(this, _status_extraInitializers), __runInitializers(this, _resource_initializers, void 0));
        action = (__runInitializers(this, _resource_extraInitializers), __runInitializers(this, _action_initializers, void 0));
        description = (__runInitializers(this, _action_extraInitializers), __runInitializers(this, _description_initializers, void 0));
        mcp = (__runInitializers(this, _description_extraInitializers), __runInitializers(this, _mcp_initializers, void 0));
        bash = (__runInitializers(this, _mcp_extraInitializers), __runInitializers(this, _bash_initializers, void 0));
        metadata = (__runInitializers(this, _bash_extraInitializers), __runInitializers(this, _metadata_initializers, void 0));
        constructor() {
            __runInitializers(this, _metadata_extraInitializers);
        }
    };
})();
export { UpdateRuleDto };
//# sourceMappingURL=UpdateRule.dto.js.map