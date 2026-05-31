/**
 * Recovery passcode MCP tool — ported from transcodes-mcp-server's
 * `src/tools/passcode.ts`.
 *
 * Step-up enforcement is via the PreToolUse hook (tool-rule
 * `tc-passcode-create`); this handler only threads the verified sid.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadStepupConfig } from "@transcodes-guard/stepup-core";
import { req } from "./transcodes-client.js";
import { withStepupVerifiedSid } from "./stepup-helper.js";

const textResult = (text: string, isError = false) => ({
  isError,
  content: [{ type: "text" as const, text }],
});

export function registerPasscodeTools(server: McpServer): void {
  server.registerTool(
    "passcode_create",
    {
      title: "Create recovery passcode",
      description:
        "Create a recovery passcode (CreatePasscodeDto in body). " +
        "Verified action — step-up MFA enforced by the PreToolUse hook (tool-rule `tc-passcode-create`). " +
        "Use for onboarding, support, or admin provisioning.",
      inputSchema: {
        body: z.object({ member_id: z.string() }),
      },
    },
    async ({ body }) => {
      const config = loadStepupConfig();
      const text = await withStepupVerifiedSid("passcode_create", (sid) =>
        req(
          config,
          {
            method: "POST",
            body: { ...body, project_id: config.projectId },
            stepUpSid: sid,
          },
          "passcode_create",
        ),
      );
      return textResult(text);
    },
  );
}
