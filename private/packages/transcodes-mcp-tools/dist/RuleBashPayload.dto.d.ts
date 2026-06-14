import { type RuleMatcher } from '../types/rule.constants';
/** Bash command match criteria. */
export declare class RuleBashPayloadDto {
    pattern: string;
    matcher: RuleMatcher;
}
