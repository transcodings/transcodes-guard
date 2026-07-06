/**
 * JWK backup (console-only) — ported from transcodes-mcp-server's
 * `src/tools/jwk.ts`. Not callable via API; registered for discoverability
 * so the agent routes the user to the console. Pair with `get_console_url`
 * for the protected console link.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerJwkTools(server: McpServer): void;
