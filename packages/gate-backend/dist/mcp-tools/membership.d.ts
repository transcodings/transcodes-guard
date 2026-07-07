/**
 * Membership / billing MCP tools — ported from transcodes-mcp-server's
 * `src/tools/membership.ts`.
 *
 * Read tools (`membership_plans`, `membership_plans_limits`,
 * `membership_customer_status_by_*`) are plain backend calls. The checkout
 * tool returns a Stripe redirect URL. The billing portal (cancel / payment
 * method / invoices) stays console-only — surface it via `get_console_url`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerMembershipTools(server: McpServer): void;
