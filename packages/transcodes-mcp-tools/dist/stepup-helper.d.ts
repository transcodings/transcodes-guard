/**
 * RBAC + optional step-up sid for protected MCP tool handlers.
 * Hook is first line; this re-checks on handler run (stdio/curl bypass backstop).
 * Matrix: 0=block, 1=pass (no sid), 2=step-up (verified sid required).
 */
import { type MergedToolRule } from '@transcodes-guard/danger-patterns';
export declare function resolveProtectedToolRule(toolName: string, rules?: MergedToolRule[]): MergedToolRule | undefined;
export declare function execProtectedTool(toolName: string, run: (sid: string | undefined) => Promise<string>): Promise<{
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
}>;
