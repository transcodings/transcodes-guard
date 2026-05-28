#!/usr/bin/env node
import "../host.js";
/**
 * MCP stdio entrypoint for the Google Antigravity 2.0 plugin.
 *
 * Imports the host-agnostic createServer from @ai-action-tracker/mcp-server-core
 * (same binary the Claude Code and Codex plugins use) and connects it to a
 * StdioServerTransport for Antigravity's `mcp_config.json` process model.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "@ai-action-tracker/mcp-server-core";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ai-action-tracker-mcp: stdio transport ready (antigravity)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
