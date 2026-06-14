#!/usr/bin/env node
import '../host.js';
import '../backend.js';
/**
 * MCP stdio entrypoint for the Cursor IDE plugin.
 *
 * Identical shape to the Claude Code / Codex / Antigravity stdio entries —
 * imports the shared createServer from @transcodes-guard/mcp-server-core
 * and connects it to a StdioServerTransport. Cursor registers MCP servers
 * via `~/.cursor/mcp.json` (Claude Desktop format), so the binary path in
 * that config points at `dist/src/stdio.js` produced from this file.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '@transcodes-guard/mcp-server-core';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('transcodes-guard-mcp: stdio transport ready (cursor)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
