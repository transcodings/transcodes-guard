import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

// Single-file CJS for Electron RunAsNode. Desktop ships this as
// Transcodes.app/Contents/Resources/cli/index.cjs so the app does not
// need a system Node install or leftover node_modules next to the CLI.
export default defineConfig({
  entry: { 'index': 'src/index.ts' },
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: [/.*/],
  define: {
    'process.env.TRANSCODES_CLI_NAME': JSON.stringify(pkg.name),
    'process.env.TRANSCODES_CLI_VERSION': JSON.stringify(pkg.version),
  },
  banner: { js: '#!/usr/bin/env node' },
  outDir: 'dist-desktop',
  outExtension: () => ({ js: '.cjs' }),
  clean: true,
  sourcemap: false,
  dts: false,
  splitting: false,
});
