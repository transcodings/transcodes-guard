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
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
/** Request DTO for deleting a rule (body on DELETE). */
let DeleteRuleDto = (() => {
    let _project_id_decorators;
    let _project_id_initializers = [];
    let _project_id_extraInitializers = [];
    let _member_id_decorators;
    let _member_id_initializers = [];
    let _member_id_extraInitializers = [];
    return class DeleteRuleDto {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _project_id_decorators = [ApiProperty({ example: 'project-1234' }), IsString(), IsNotEmpty()];
            _member_id_decorators = [ApiProperty({ example: 'member-5678' }), IsString(), IsNotEmpty()];
            __esDecorate(null, null, _project_id_decorators, { kind: "field", name: "project_id", static: false, private: false, access: { has: obj => "project_id" in obj, get: obj => obj.project_id, set: (obj, value) => { obj.project_id = value; } }, metadata: _metadata }, _project_id_initializers, _project_id_extraInitializers);
            __esDecorate(null, null, _member_id_decorators, { kind: "field", name: "member_id", static: false, private: false, access: { has: obj => "member_id" in obj, get: obj => obj.member_id, set: (obj, value) => { obj.member_id = value; } }, metadata: _metadata }, _member_id_initializers, _member_id_extraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        project_id = __runInitializers(this, _project_id_initializers, void 0);
        member_id = (__runInitializers(this, _project_id_extraInitializers), __runInitializers(this, _member_id_initializers, void 0));
        constructor() {
            __runInitializers(this, _member_id_extraInitializers);
        }
    };
})();
export { DeleteRuleDto };
//# sourceMappingURL=DeleteRule.dto.js.map