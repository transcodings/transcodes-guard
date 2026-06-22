import { defineConfig } from 'tsup';

// The MCP server ships to npm independently of the marketplace plugins (for
// Claude Desktop / claude.ai connectors and any MCP client), so it must be
// fully self-contained: bundle every internal @transcodes-guard/* workspace
// package AND the real runtime deps (@modelcontextprotocol/sdk, zod) into a
// single ESM file. Externalising them would crash `npx @bigstrider/transcodes-mcp`
// with ERR_MODULE_NOT_FOUND, since the published tarball has no node_modules.
// Node builtins stay external.
//
// host.ts is NOT a separate entry — it is a side-effect module imported first
// by stdio.ts and gets bundled in, preserving the `import './host.js'`
// source-order guarantee (TRANSCODES_GUARD_HOST set before mcp-server-core).
export default defineConfig({
  entry: ['src/stdio.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: [
    /^@transcodes-guard(-private)?\//,
    'zod',
    /^@modelcontextprotocol\/sdk/,
  ],
  clean: true,
  sourcemap: false,
  dts: false,
});
