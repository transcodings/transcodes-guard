import { defineConfig } from "tsup";

// Self-contained npm package: bundle internal @ai-action-tracker/* (never
// published), keep @modelcontextprotocol/sdk + zod external. Entry keys
// preserve the dist layout the manifests reference. host.ts is bundled in via
// the first `import "../host.js"` of each entry. No `banner` — esbuild keeps the
// per-entry source shebang so split chunks stay shebang-free.
// Cursor uses beforeSubmitPrompt (no UserPromptSubmit equivalent with context).
export default defineConfig({
  entry: {
    "src/stdio": "src/stdio.ts",
    "hooks/pre-tool-use": "hooks/pre-tool-use.ts",
    "hooks/session-start": "hooks/session-start.ts",
    "hooks/before-submit-prompt": "hooks/before-submit-prompt.ts",
    "hooks/stop": "hooks/stop.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  noExternal: [/^@ai-action-tracker\//],
  splitting: true,
  clean: true,
  sourcemap: false,
  dts: false,
});
