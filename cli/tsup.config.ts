import { defineConfig } from 'tsup';

// The CLI ships to npm independently of the marketplace plugins, so it must
// be self-contained: bundle every internal workspace package — both
// @transcodes-guard/* and @transcodes-guard/* (neither is published
// standalone) — into a single ESM file. Node builtins stay external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: [/^@transcodes-guard(-private)?\//],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: false,
  dts: false,
});
