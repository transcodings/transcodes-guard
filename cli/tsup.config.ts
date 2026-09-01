import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  name: string;
  version: string;
};

// The CLI ships to npm independently of the marketplace plugins, so it must
// be self-contained for internal workspace packages: bundle every
// @transcodes-guard/* package into a single ESM file.
//
// Project sync (`transcodes sync`) lives under src/commands/transcodes/ with
// engine in src/commands/sync/. CJS-heavy deps break under tsup's ESM
// require shim — keep those external. Bundle zod (v4 / zod/mini) so a hoisted
// zod@3 cannot win.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: [/^@transcodes-guard(-private)?\//],
  external: [
    'globby',
    'gray-matter',
    'js-yaml',
    'jsonc-parser',
    'smol-toml',
    'es-toolkit',
    'es-toolkit/promise',
    '@toon-format/toon',
  ],
  define: {
    'process.env.TRANSCODES_CLI_NAME': JSON.stringify(pkg.name),
    'process.env.TRANSCODES_CLI_VERSION': JSON.stringify(pkg.version),
  },
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: false,
  dts: false,
});
