#!/usr/bin/env node
import {
  createServer
} from "../chunk-TCGM6T2Z.js";
import "../chunk-LHLN6C4G.js";

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
