#!/usr/bin/env node
process.env.AI_ACTION_TRACKER_HOST = "claude-code";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "@ai-action-tracker/mcp-server-core";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ai-action-tracker-mcp: stdio transport ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
