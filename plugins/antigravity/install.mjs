#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to resolve home directory shorthand (~)
function resolveHome(filepath) {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

// Replace the __PLUGIN_DIR__ placeholder in a copied config with the install
// dir's absolute path. The absolute path is forward-slash normalized so it is
// safe to embed in JSON strings and shell commands on Windows (raw backslashes
// would be invalid JSON escapes). Throws if the placeholder is absent so a
// config-format drift fails loudly at install time instead of silently
// shipping a broken relative path that only breaks at runtime.
function rewritePluginDir(configPath, targetDir) {
  if (!fs.existsSync(configPath)) return;
  const pluginDir = targetDir.split(path.sep).join('/');
  const content = fs.readFileSync(configPath, 'utf8');
  if (!content.includes('__PLUGIN_DIR__')) {
    throw new Error(`__PLUGIN_DIR__ placeholder not found in ${configPath} — config format changed; update install.mjs.`);
  }
  fs.writeFileSync(configPath, content.split('__PLUGIN_DIR__').join(pluginDir), 'utf8');
  console.log(`- Path rewrite completed in: ${configPath}`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const isLocal = args.includes('--local');

// Determine target installation directories
const targetDirs = [];
if (isLocal) {
  // Local workspace installation
  targetDirs.push(path.resolve(process.cwd(), '.agents/plugins/transcodes-guard'));
} else {
  // Global installation for both Desktop App/IDE and CLI (agy)
  targetDirs.push(resolveHome('~/.gemini/config/plugins/transcodes-guard'));
}

// Assets to copy
const filesToCopy = [
  'plugin.json',
  'mcp_config.json',
  'hooks.json',
  'rules',
  'dist',
  // /transcodes umbrella command. Antigravity auto-converts a plugin's
  // skills/<name>/SKILL.md into the /<name> slash command in the TUI.
  'skills'
];

console.log('Starting Google Antigravity plugin installation...');

targetDirs.forEach((targetDir) => {
  console.log(`Installing to: ${targetDir}`);
  
  // Ensure the directory exists
  fs.mkdirSync(targetDir, { recursive: true });
  
  // Copy plugin assets (force overwrites in place — no destructive pre-delete)
  filesToCopy.forEach((item) => {
    const srcPath = path.resolve(__dirname, item);
    const destPath = path.join(targetDir, item);
    if (fs.existsSync(srcPath)) {
      fs.cpSync(srcPath, destPath, { recursive: true, force: true });
    } else {
      console.warn(`Warning: Source file/folder "${item}" not found.`);
    }
  });

  // Resolve the __PLUGIN_DIR__ placeholder to this install dir's absolute path
  rewritePluginDir(path.join(targetDir, 'hooks.json'), targetDir);
  rewritePluginDir(path.join(targetDir, 'mcp_config.json'), targetDir);
});

console.log('Google Antigravity plugin installation completed successfully!');
