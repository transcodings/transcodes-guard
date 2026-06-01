import { defineConfig } from 'tsup';

// This plugin ships to npm as a self-contained package: the internal
// @transcodes-guard/* workspace packages are never published, so they must be
// bundled into the plugin (noExternal). Real runtime deps (@modelcontextprotocol/sdk,
// zod — declared in `dependencies`) are auto-externalised by tsup and stay external.
//
// Multi-entry: every transport + hook entry the manifests reference. The entry
// KEYS preserve the dist layout (dist/src/stdio.js, dist/hooks/*.js) that
// .mcp.json / hooks.json / bin point at. host.ts is NOT an entry — it is a
// side-effect module imported first by every entry and gets bundled in, keeping
// the `import "../host.js"` source-order guarantee (TRANSCODES_GUARD_HOST set
// before hook-adapters' barrel evaluates).
//
// No `banner` shebang: esbuild preserves the `#!/usr/bin/env node` already on
// each executable entry source, so shared chunks (splitting) stay shebang-free.
export default defineConfig({
  entry: {
    'src/stdio': 'src/stdio.ts',
    'src/http': 'src/http.ts',
    'hooks/pre-tool-use': 'hooks/pre-tool-use.ts',
    'hooks/session-start': 'hooks/session-start.ts',
    'hooks/user-prompt-submit': 'hooks/user-prompt-submit.ts',
    'hooks/stop': 'hooks/stop.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: [/^@transcodes-guard(-private)?\//],
  splitting: true,
  clean: true,
  sourcemap: false,
  dts: false,
});
