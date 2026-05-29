#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.ts';
import { createMcpServer, log } from './server.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '..', '.env') });

if (Number.parseInt(process.versions.node.split('.')[0], 10) < 20) {
  console.error(`[transcodes-mcp-server] Requires Node.js 20+. Current: ${process.version}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const mcp = createMcpServer(config);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  log('ready');

  const shutdown = async () => {
    log('shutting down…');
    await mcp.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[transcodes-mcp-server] fatal: ${err}\n`);
  process.exit(1);
});
