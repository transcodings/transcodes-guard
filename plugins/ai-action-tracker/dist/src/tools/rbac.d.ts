/**
 * RBAC MCP tools — ported from transcodes-mcp-server's `src/tools/rbac.ts`.
 * Scope is intentionally narrow: only the step-up-protected mutations
 * (`retire_role`, `set_role_permissions`, `update_member_role`,
 * `retire_resource`) plus the read tools needed to investigate them
 * (`get_roles`, `get_resources`, `check_rbac_permission`).
 *
 * Protected handlers thread the verified sid via `withStepupVerifiedSid`;
 * the in-memory `requireStepup` pattern is gone — the PreToolUse hook
 * now enforces via `hooks/tool-rules.json`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerRbacTools(server: McpServer): void;
