/**
 * Member directory MCP tools — ported from transcodes-mcp-server's
 * `src/tools/members.ts`.
 *
 * Read tools (`get_member`, `list_members_paginated`, `list_member_devices`,
 * `get_member_suspension`) are plain backend calls. Protected tools
 * (`retire_member`, `suspend_member`, `unsuspend_member`) are gated by the
 * PreToolUse hook via tool-rules; here they only thread the verified sid
 * via `withStepupVerifiedSid` so the backend can validate.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerMemberTools(server: McpServer): void;
