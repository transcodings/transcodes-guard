/**
 * Recovery passcode MCP tool — ported from transcodes-mcp-server's
 * `src/tools/passcode.ts`.
 *
 * Step-up enforcement is via the PreToolUse hook (tool-rule
 * `tc-passcode-create`); this handler only threads the verified sid.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerPasscodeTools(server: McpServer): void;
