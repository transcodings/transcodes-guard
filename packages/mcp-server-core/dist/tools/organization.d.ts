/**
 * Console-only (blocked) tools — ported from transcodes-mcp-server's
 * `src/tools/organization.ts`.
 *
 * None of these call the backend. They are registered for *discoverability*:
 * when a user asks "what can I do?" or requests user/organization management
 * or per-member token issuance, the agent surfaces the capability and routes
 * the user to the Transcodes console instead of inventing an unsupported
 * action. For the protected console link, pair with `get_console_url`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerOrganizationTools(server: McpServer): void;
