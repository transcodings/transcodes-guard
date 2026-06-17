/**
 * Dev-only preload: load repo-root `.env.local` when present.
 * Used by plugin `dev:*` npm scripts via `node -r ../../scripts/load-dev-env.cjs`.
 * Never imported by shipped plugin bundles.
 */
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { config } = require('dotenv');

const envLocal = resolve(__dirname, '../.env.local');
if (existsSync(envLocal)) {
  config({ path: envLocal });
}
