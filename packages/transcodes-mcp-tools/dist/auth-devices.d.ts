/**
 * Auth-device read tools — ported from transcodes-mcp-server's
 * `src/tools/authenticators.ts`, `passkeys.ts`, and `totp.ts`.
 *
 * All read-only (list/get); device registration/revocation is browser-only
 * and handled via the console, so only the audit reads are exposed here.
 * Project is fixed by the TRANSCODES_TOKEN pid claim.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerAuthDeviceTools(server: McpServer): void;
