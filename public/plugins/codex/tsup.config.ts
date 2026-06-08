import { defineConfig } from 'tsup';

// Fully self-contained bundle: the committed dist/ is run directly from a git
// clone (no `npm install`, no node_modules), so internal @transcodes-guard/*
// AND runtime deps (@modelcontextprotocol/sdk, zod) must all be bundled
// (noExternal). Externalising zod/the SDK crashes every hook with
// ERR_MODULE_NOT_FOUND in a real install. Entry keys preserve the dist layout
// the manifests reference. host.ts is bundled in via the first
// `import "../host.js"` of each entry. No `banner` — esbuild keeps the
// per-entry source shebang so split chunks stay shebang-free.
// Codex has no HTTP transport (stdio-only MCP integration).
export default defineConfig({
  entry: {
    'src/stdio': 'src/stdio.ts',
    'hooks/pre-tool-use': 'hooks/pre-tool-use.ts',
    'hooks/session-start': 'hooks/session-start.ts',
    'hooks/user-prompt-submit': 'hooks/user-prompt-submit.ts',
    'hooks/stop': 'hooks/stop.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: [
    /^@transcodes-guard(-private)?\//,
    'zod',
    /^@modelcontextprotocol\/sdk/,
  ],
  splitting: true,
  clean: true,
  sourcemap: false,
  dts: false,
});
