/**
 * Read-only catalog of every MCP tool registered in createServer().
 * Used by the transcodes CLI dashboard — kept in sync with registerTool()
 * calls under src/tools/ and server.ts.
 */
export type AdminToolAccess = 'api' | 'console-only' | 'gate';
export type AdminToolEntry = {
    /** Short registerTool name (e.g. get_member). */
    name: string;
    /** Human title from registerTool metadata. */
    title: string;
    /** One-line summary for dashboard cards. */
    description: string;
    category: string;
    access: AdminToolAccess;
    /** PreToolUse step-up enforced via system tool-rules.json. */
    stepUpProtected: boolean;
};
/** Claude Code wire prefix for this plugin's MCP tools. */
export declare const TRANSCODES_MCP_PREFIX = "mcp__plugin_transcodes-guard_transcodes-guard__";
export declare function mcpWireName(toolName: string): string;
/** All Transcodes Admin MCP tools, grouped for display. */
export declare const TRANSCODES_ADMIN_TOOLS: AdminToolEntry[];
export type AdminToolsPayload = {
    prefix: string;
    total: number;
    tools: Array<AdminToolEntry & {
        mcpToolName: string;
    }>;
};
export declare function buildAdminToolsPayload(): AdminToolsPayload;
