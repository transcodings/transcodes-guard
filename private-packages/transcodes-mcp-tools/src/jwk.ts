/**
 * JWK backup (console-only) — ported from transcodes-mcp-server's
 * `src/tools/jwk.ts`. Not callable via API; registered for discoverability
 * so the agent routes the user to the console. Pair with `get_console_url`
 * for the protected console link.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { blockedResult } from "./transcodes-client.js";

const MSG_JWK_BACKUP_CONSOLE =
  "JWK backup (encrypted download of member metadata, registered authentication methods, and audit logs) must be done in the Transcodes console. This MCP tool does not call the API.";

export function registerJwkTools(server: McpServer): void {
  server.registerTool(
    "jwk_backup",
    {
      title: "JWK backup (console-only)",
      description:
        "Blocked: JWK backup must be performed in the Transcodes console only. That flow yields an encrypted backup bundle that can include member metadata, authentication methods, and audit logs — not exposed through MCP.",
      inputSchema: {},
    },
    async () => blockedResult(MSG_JWK_BACKUP_CONSOLE),
  );
}
