#!/usr/bin/env node
import {
  createServer
} from "../chunk-IAY6PRU4.js";
import "../chunk-3J7XK5DB.js";

// src/stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("transcodes-guard-mcp: stdio transport ready");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
