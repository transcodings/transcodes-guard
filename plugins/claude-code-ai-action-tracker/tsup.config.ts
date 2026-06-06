import { defineConfig } from 'tsup';

// The committed dist/ is the distribution artifact: Claude Code installs this
// plugin by git-cloning the repo (`/plugin marketplace add …`) and running the
// committed dist/ directly — there is NO `npm install` step, so the plugin
// cache has no node_modules. The bundle must therefore be FULLY self-contained:
// the internal @transcodes-guard/* workspace packages AND the real runtime deps
// (@modelcontextprotocol/sdk, zod) are all bundled (noExternal). Externalising
// zod/the SDK would crash every hook with ERR_MODULE_NOT_FOUND in a real
// install (it only "worked" from the workspace because of hoisted node_modules).
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
