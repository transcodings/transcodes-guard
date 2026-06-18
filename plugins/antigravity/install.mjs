#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

// Function to copy file or folder recursively
function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
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
  targetDirs.push(resolveHome('~/.gemini/antigravity-cli/plugins/transcodes-guard'));
}

// Assets to copy
const filesToCopy = [
  'plugin.json',
  'mcp_config.json',
  'hooks.json',
  'rules',
  'dist'
];

console.log('Starting Google Antigravity plugin installation...');

targetDirs.forEach((targetDir) => {
  console.log(`Installing to: ${targetDir}`);
  
  // Ensure the directory exists
  fs.mkdirSync(targetDir, { recursive: true });
  
  // Copy plugin assets
  filesToCopy.forEach((item) => {
    const srcPath = path.resolve(__dirname, item);
    const destPath = path.join(targetDir, item);
    if (fs.existsSync(srcPath)) {
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      copyRecursiveSync(srcPath, destPath);
    } else {
      console.warn(`Warning: Source file/folder "${item}" not found.`);
    }
  });

  // Rewrite relative paths inside hooks.json to absolute paths
  const hooksJsonPath = path.join(targetDir, 'hooks.json');
  if (fs.existsSync(hooksJsonPath)) {
    let content = fs.readFileSync(hooksJsonPath, 'utf8');
    const regex = /node\s+\.\/dist\//g;
    content = content.replace(regex, `node ${path.join(targetDir, 'dist')}/`);
    fs.writeFileSync(hooksJsonPath, content, 'utf8');
    console.log(`- Path rewrite completed in: ${hooksJsonPath}`);
  }

  // Rewrite relative paths inside mcp_config.json to absolute paths
  const mcpConfigPath = path.join(targetDir, 'mcp_config.json');
  if (fs.existsSync(mcpConfigPath)) {
    let content = fs.readFileSync(mcpConfigPath, 'utf8');
    const regex = /"\.\/dist\//g;
    content = content.replace(regex, `"${path.join(targetDir, 'dist')}/`);
    fs.writeFileSync(mcpConfigPath, content, 'utf8');
    console.log(`- Path rewrite completed in: ${mcpConfigPath}`);
  }
});

console.log('Google Antigravity plugin installation completed successfully!');
