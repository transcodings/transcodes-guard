#!/usr/bin/env node
import '../host.js';
import '../backend.js';
/**
 * MCP stdio entrypoint for the Codex CLI plugin.
 *
 * Imports the host-agnostic createServer from @transcodes-guard/mcp-server-core
 * (same binary the Claude Code plugin uses) and connects it to a StdioServerTransport
 * for Codex's mcp_servers process model.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '@transcodes-guard/mcp-server-core';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('transcodes-guard-mcp: stdio transport ready (codex)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
