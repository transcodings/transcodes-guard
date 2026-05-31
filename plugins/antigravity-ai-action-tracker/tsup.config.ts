import { defineConfig } from "tsup";

// Self-contained npm package: bundle internal @transcodes-guard/* (never
// published), keep @modelcontextprotocol/sdk + zod external. Entry keys
// preserve the dist layout the manifests reference. host.ts is bundled in via
// the first `import "../host.js"` of each entry. No `banner` — esbuild keeps the
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
  noExternal: [/^@transcodes-guard\//],
  splitting: true,
  clean: true,
  sourcemap: false,
  dts: false,
});
