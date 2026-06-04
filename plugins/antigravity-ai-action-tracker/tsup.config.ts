import { defineConfig } from "tsup";

// Fully self-contained bundle: the committed dist/ is run directly from a git
// clone (`agy plugin install <git-url>`; no `npm install`, no node_modules), so
// internal @transcodes-guard/* AND runtime deps (@modelcontextprotocol/sdk,
// zod) must all be bundled (noExternal). Externalising zod/the SDK crashes
// every hook with ERR_MODULE_NOT_FOUND in a real install. Entry keys preserve
// the dist layout the manifests reference. host.ts is bundled in via the first
// `import "../host.js"` of each entry. No `banner` — esbuild keeps the
// per-entry source shebang so split chunks stay shebang-free.
// Antigravity uses 3 hooks: PreInvocation merges SessionStart + UserPromptSubmit.
export default defineConfig({
  entry: {
    "src/stdio": "src/stdio.ts",
    "hooks/pre-tool-use": "hooks/pre-tool-use.ts",
    "hooks/pre-invocation": "hooks/pre-invocation.ts",
    "hooks/stop": "hooks/stop.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  noExternal: [/^@transcodes-guard\//, "zod", /^@modelcontextprotocol\/sdk/],
  splitting: true,
  clean: true,
  sourcemap: false,
  dts: false,
});
