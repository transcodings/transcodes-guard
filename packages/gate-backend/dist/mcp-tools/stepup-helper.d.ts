/**
 * RBAC + optional step-up sid for protected MCP tool handlers.
 * Hook is first line; this re-checks on handler run (stdio/curl bypass backstop).
 * Matrix: 0=block, 1=pass (no sid), 2=step-up (verified sid required).
 *
 * Guard v3: the "verified" signal is no longer an on-disk record. The poll
 * tools mark a backend-verified sid in the server's in-memory verified set
 * (`verified-memory.ts`); this backstop consumes it single-shot via
 * `claimStepupVerified()`. Same long-lived MCP server process, so the mark →
 * claim handoff never crosses a process boundary.
 */
import type { ProtectedToolDefinition, ToolTextResult } from '@transcodes-guard/core/contract';
import { type MergedToolRule } from '@transcodes-guard/core/patterns';
export declare const SYSTEM_PROTECTED_TOOL_RULES: readonly MergedToolRule[];
export declare function resolveProtectedToolRule(toolName: string, rules?: readonly MergedToolRule[]): MergedToolRule | undefined;
export declare function wrapProtectedTool(def: ProtectedToolDefinition): (args: never) => Promise<ToolTextResult>;
export declare function execProtectedTool(toolName: string, run: (sid: string | undefined) => Promise<string>): Promise<{
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
}>;
