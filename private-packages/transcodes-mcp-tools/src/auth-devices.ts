/**
 * Auth-device read tools — ported from transcodes-mcp-server's
 * `src/tools/authenticators.ts`, `passkeys.ts`, and `totp.ts`.
 *
 * All read-only (list/get); device registration/revocation is browser-only
 * and handled via the console, so only the audit reads are exposed here.
 * Project is fixed by the TRANSCODES_TOKEN pid claim.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadStepupConfig } from "@transcodes-guard-private/stepup-core";
import { req } from "./transcodes-client.js";

const textResult = (text: string, isError = false) => ({
  isError,
  content: [{ type: "text" as const, text }],
});

export function registerAuthDeviceTools(server: McpServer): void {
  server.registerTool(
    "list_authenticators",
    {
      title: "List authenticators",
      description:
        "List all WebAuthn authenticators for a member. Separate from the passkey service. Requires member_id.",
      inputSchema: {
        member_id: z.string(),
      },
    },
    async ({ member_id }) => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        {
          method: "GET",
          query: { project_id: config.projectId, member_id },
        },
        "list_authenticators",
      );
      return textResult(text);
    },
  );

  server.registerTool(
    "list_passkeys",
    {
      title: "List passkeys",
      description:
        "List passkeys for a member. Server typically filters by project rp_id. Requires member_id.",
      inputSchema: {
        member_id: z.string(),
      },
    },
    async ({ member_id }) => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        {
          method: "GET",
          query: { project_id: config.projectId, member_id },
        },
        "list_passkeys",
      );
      return textResult(text);
    },
  );

  server.registerTool(
    "list_totps",
    {
      title: "List TOTP devices",
      description:
        "List TOTP devices for a member. Use to audit MFA enrollment. Requires member_id.",
      inputSchema: {
        member_id: z.string(),
      },
    },
    async ({ member_id }) => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        {
          method: "GET",
          query: { project_id: config.projectId, member_id },
        },
        "list_totps",
      );
      return textResult(text);
    },
  );
}
