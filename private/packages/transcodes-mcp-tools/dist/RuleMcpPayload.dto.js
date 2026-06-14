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
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { RULE_MATCHERS } from '../types/rule.constants';
/** MCP agent tool match criteria. */
let RuleMcpPayloadDto = (() => {
    let _server_decorators;
    let _server_initializers = [];
    let _server_extraInitializers = [];
    let _tool_decorators;
    let _tool_initializers = [];
    let _tool_extraInitializers = [];
    let _matcher_decorators;
    let _matcher_initializers = [];
    let _matcher_extraInitializers = [];
    return class RuleMcpPayloadDto {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _server_decorators = [ApiProperty({ example: 'transcodes-dev' }), IsString(), IsNotEmpty(), MaxLength(200)];
            _tool_decorators = [ApiProperty({ example: 'create_member' }), IsString(), IsNotEmpty(), MaxLength(200)];
            _matcher_decorators = [ApiProperty({ enum: RULE_MATCHERS, example: 'exact' }), IsIn(RULE_MATCHERS)];
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
export { RuleMcpPayloadDto };
//# sourceMappingURL=RuleMcpPayload.dto.js.map