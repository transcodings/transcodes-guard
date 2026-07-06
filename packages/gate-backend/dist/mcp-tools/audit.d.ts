/**
 * Audit-log MCP tool — ported from transcodes-mcp-server's `src/tools/audit.ts`.
 * Read-only; project is fixed by the TRANSCODES_TOKEN pid claim.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerAuditTools(server: McpServer): void;
