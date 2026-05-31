#!/usr/bin/env node
import {
  createServer
} from "../chunk-SITV72JK.js";
import "../chunk-RFH4GXTJ.js";

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
