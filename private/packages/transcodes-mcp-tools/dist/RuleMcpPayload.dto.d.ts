import { type RuleMatcher } from '../types/rule.constants';
/** MCP agent tool match criteria. */
export declare class RuleMcpPayloadDto {
    server: string;
    tool: string;
    matcher: RuleMatcher;
}
