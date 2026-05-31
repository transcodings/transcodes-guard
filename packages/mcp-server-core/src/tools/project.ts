/**
 * Project MCP tool — ported from transcodes-mcp-server's `src/tools/project.ts`.
 *
 * Only `get_project` is carried over (read-only). Console-only configuration
 * tools (`project_pwa_auth_console`) are intentionally not exposed in this
 * plugin. The project is fixed by the TRANSCODES_TOKEN pid claim, never a
 * tool argument, so tenancy cannot be bypassed.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadStepupConfig } from "@transcodes-guard/stepup-core";
import { blockedResult, req } from "./transcodes-client.js";

const textResult = (text: string, isError = false) => ({
  isError,
  content: [{ type: "text" as const, text }],
});

const MSG_PROJECT_PWA_AUTH_CONSOLE =
  "PWA and authentication configuration (manifest, service worker, widget, branding, WebAuthn, related origins, token expiry, etc.) must be performed in the Transcodes console. " +
  "Changes to these settings require the project SDK to be rebuilt and redeployed — a process that the console handles automatically. " +
  "Modifying them directly via API without going through the console build pipeline will leave the deployed SDK out of sync with your configuration. " +
  "This MCP tool does not call the API.";

export function registerProjectTools(server: McpServer): void {
  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description:
        "Fetch the active project (fixed by TRANSCODES_TOKEN pid claim). " +
        "Returns all information about the project — including toolkit, pwa, domain_url, title, description, and created/updated timestamps. " +
        "No arguments — project is determined by the token.",
      inputSchema: {},
    },
    async () => {
      const config = loadStepupConfig();
      const text = await req(
        config,
        { method: "GET" },
        "get_project",
        `/${config.projectId}`,
      );
      return textResult(text);
    },
  );

  server.registerTool(
    "project_pwa_auth_console",
    {
      title: "PWA / auth config (console-only)",
      description:
        "Blocked: PWA and authentication configuration (manifest, service worker, branding, WebAuthn, related origins, token expiry, etc.) must be done in the Transcodes console. " +
        "These settings trigger an SDK rebuild and redeployment — a pipeline the console manages automatically. " +
        "Applying changes directly via API skips that pipeline and leaves the live SDK out of sync with the new configuration.",
      inputSchema: {},
    },
    async () => blockedResult(MSG_PROJECT_PWA_AUTH_CONSOLE),
  );
}
