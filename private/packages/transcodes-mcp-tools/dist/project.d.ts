/**
 * Project MCP tool — ported from transcodes-mcp-server's `src/tools/project.ts`.
 *
 * Only `get_project` is carried over (read-only). Console-only configuration
 * tools (`project_pwa_auth_console`) are intentionally not exposed in this
 * plugin. The project is fixed by the TRANSCODES_TOKEN pid claim, never a
 * tool argument, so tenancy cannot be bypassed.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerProjectTools(server: McpServer): void;
