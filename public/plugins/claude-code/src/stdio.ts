#!/usr/bin/env node
import '../host.js';
import '../backend.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '@transcodes-guard/mcp-server-core';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('transcodes-guard-mcp: stdio transport ready');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
