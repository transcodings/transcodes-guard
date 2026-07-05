#!/usr/bin/env node
/**
 * Google Antigravity plugin installer.
 *
 * Copies the committed dist/ bundle into a fixed plugin directory and rewrites
 * __PLUGIN_DIR__ in hooks.json / mcp_config.json to absolute paths. Antigravity
 * has no plugin-root env var, so paths must be baked in at install time.
 *
 * Installs only to ~/.gemini/config/plugins/transcodes-guard (or --local workspace
 * copy). Does NOT register user-level hook/MCP files — other Antigravity plugins
 * under ~/.gemini/config/plugins/ are untouched.
 *
 * Does NOT touch ~/.transcodes/ (token, step-up state, policy cache).
 *
 * Usage:
 *   node plugins/antigravity/install.mjs          # ~/.gemini/config/plugins/transcodes-guard
 *   node plugins/antigravity/install.mjs --local  # <cwd>/.agents/plugins/transcodes-guard
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filesToCopy = [
  'plugin.json',
  'mcp_config.json',
  'hooks.json',
  'rules',
  'dist',
  'skills',
];

function resolveHome(filepath) {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function rewritePluginDir(configPath, targetDir) {
  if (!fs.existsSync(configPath)) return;
  const pluginDir = targetDir.split(path.sep).join('/');
  const content = fs.readFileSync(configPath, 'utf8');
  if (!content.includes('__PLUGIN_DIR__')) {
    throw new Error(
      `__PLUGIN_DIR__ placeholder not found in ${configPath} — config format changed; update install.mjs.`,
    );
  }
  fs.writeFileSync(
    configPath,
    content.split('__PLUGIN_DIR__').join(pluginDir),
    'utf8',
  );
  console.log(`- Path rewrite completed in: ${configPath}`);
}

function printPostInstall(isLocal) {
  console.log('');
  console.log('Next steps:');
  if (isLocal) {
    console.log('  1. Restart Antigravity in this workspace.');
  } else {
    console.log('  1. Restart Antigravity desktop app and/or `agy` CLI session.');
    console.log('  2. Confirm: `agy plugin list` shows transcodes-guard.');
  }
  console.log('  3. Save your token: npm install -g @bigstrider/transcodes-cli && transcodes');
  console.log('');
  console.log('Re-run this installer to update in place.');
  console.log('Do not use `agy plugin install` on this monorepo — it skips __PLUGIN_DIR__ rewrite.');
}

const isLocal = process.argv.includes('--local');

const targetDirs = isLocal
  ? [path.resolve(process.cwd(), '.agents/plugins/transcodes-guard')]
  : [resolveHome('~/.gemini/config/plugins/transcodes-guard')];

console.log('Starting Google Antigravity transcodes-guard plugin installation...');

for (const targetDir of targetDirs) {
  console.log(`Installing to: ${targetDir}`);
  fs.mkdirSync(targetDir, { recursive: true });

  const distDest = path.join(targetDir, 'dist');
  if (fs.existsSync(distDest)) {
    fs.rmSync(distDest, { recursive: true, force: true });
    console.log(`- Removed stale ${distDest}/ before copy`);
  }

  for (const item of filesToCopy) {
    const srcPath = path.resolve(__dirname, item);
    const destPath = path.join(targetDir, item);
    if (fs.existsSync(srcPath)) {
      fs.cpSync(srcPath, destPath, { recursive: true, force: true });
    } else {
      console.warn(`Warning: Source "${item}" not found — run npm run build:plugin first.`);
    }
  }

  rewritePluginDir(path.join(targetDir, 'hooks.json'), targetDir);
  rewritePluginDir(path.join(targetDir, 'mcp_config.json'), targetDir);
}

console.log('');
console.log('Google Antigravity transcodes-guard plugin installation completed successfully!');
printPostInstall(isLocal);
