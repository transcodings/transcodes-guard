/**
 * Meta / identity MCP tools — ported from transcodes-mcp-server's
 * `src/tools/proxy.ts` (the non-tunnel subset) and `instructions.ts`.
 *
 * Local tools (`get_current_*_id`) read claims off the parsed token with no
 * backend call. `get_my_profile` and `get_console_url` proxy a single read.
 * `get_integration_guide` fetches the public llms.txt guide via builtin
 * fetch (no axios dependency). Tunnel tools are intentionally omitted —
 * plugins ship their own HTTP transport entry (`src/http.ts`).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerMetaTools(server: McpServer): void;
