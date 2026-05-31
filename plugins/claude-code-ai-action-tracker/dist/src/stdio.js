#!/usr/bin/env node
import {
  createServer
} from "../chunk-X5OL5HI3.js";
import "../chunk-DMIBEVDC.js";

// src/stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ai-action-tracker-mcp: stdio transport ready");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
