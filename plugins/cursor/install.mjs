#!/usr/bin/env node
/**
 * Cursor IDE plugin installer — mirrors plugins/antigravity/install.mjs.
 *
 * Copies the committed dist/ bundle into a fixed directory, rewrites
 * ${CURSOR_PLUGIN_ROOT} to absolute paths, and registers user-level
 * ~/.cursor/hooks.json and mcp.json (merge-aware — only transcodes-guard entries
 * are upserted; other user hooks / MCP servers are preserved).
 *
 * Does NOT touch ~/.transcodes/ (token, step-up state, policy cache) — only
 * the Cursor plugin bundle and hook/MCP wiring under ~/.cursor/.
 *
 * Usage:
 *   node plugins/cursor/install.mjs          # ~/.cursor/plugins/local/transcodes-guard + ~/.cursor/hooks.json
 *   node plugins/cursor/install.mjs --local  # <cwd>/.cursor/plugins/transcodes-guard + project hooks
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLACEHOLDER = '${CURSOR_PLUGIN_ROOT}';

const filesToCopy = ['.cursor-plugin', '.cursor', 'dist', 'mcp.json'];

function resolveHome(filepath) {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function toPosix(dir) {
  return dir.split(path.sep).join('/');
}

function rewritePluginRoot(configPath, pluginDir) {
  if (!fs.existsSync(configPath)) return;
  const pluginRoot = toPosix(path.resolve(pluginDir));
  const content = fs.readFileSync(configPath, 'utf8');
  if (!content.includes(PLACEHOLDER)) {
    throw new Error(
      `${PLACEHOLDER} placeholder not found in ${configPath} — config format changed; update install.mjs.`,
    );
  }
  fs.writeFileSync(
    configPath,
    content.split(PLACEHOLDER).join(pluginRoot),
    'utf8',
  );
  console.log(`- Path rewrite completed in: ${configPath}`);
}

function renderTemplate(templatePath, pluginDir) {
  const pluginRoot = toPosix(path.resolve(pluginDir));
  return fs
    .readFileSync(templatePath, 'utf8')
    .split(PLACEHOLDER)
    .join(pluginRoot);
}

const TRANSCODES_HOOK_SCRIPT =
  /\/dist\/hooks\/(pre-tool-use|session-start|before-submit-prompt|stop)\.js/;

function isTranscodesGuardHook(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const cmd = typeof entry.command === 'string' ? entry.command : '';
  return cmd.includes('/transcodes-guard/') || TRANSCODES_HOOK_SCRIPT.test(cmd);
}

function mergeHooksConfig(existingPath, renderedHooksJson) {
  const incoming = JSON.parse(renderedHooksJson);
  if (!incoming.hooks || typeof incoming.hooks !== 'object') {
    throw new Error('Rendered hooks.json is missing hooks — check plugins/cursor/.cursor/hooks.json.');
  }

  let existing = { version: 1, hooks: {} };
  if (fs.existsSync(existingPath)) {
    existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
    if (!existing.hooks || typeof existing.hooks !== 'object') {
      existing.hooks = {};
    }
  }

  existing.version = incoming.version ?? existing.version ?? 1;

  for (const [event, incomingEntries] of Object.entries(incoming.hooks)) {
    if (!Array.isArray(incomingEntries)) continue;
    const kept = (Array.isArray(existing.hooks[event]) ? existing.hooks[event] : []).filter(
      (entry) => !isTranscodesGuardHook(entry),
    );
    existing.hooks[event] = [...kept, ...incomingEntries];
  }

  fs.writeFileSync(existingPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  console.log(`- Merged ${existingPath} (transcodes-guard hooks upserted; other hooks preserved)`);
}

function mergeMcpConfig(existingPath, renderedMcpJson) {
  const incoming = JSON.parse(renderedMcpJson);
  const serverName = Object.keys(incoming.mcpServers ?? {})[0];
  const serverConfig = incoming.mcpServers?.[serverName];
  if (!serverName || !serverConfig) {
    throw new Error('Rendered mcp.json is missing mcpServers entry — check plugins/cursor/mcp.json.');
  }

  let existing = { mcpServers: {} };
  if (fs.existsSync(existingPath)) {
    existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
    if (!existing.mcpServers || typeof existing.mcpServers !== 'object') {
      existing.mcpServers = {};
    }
  }

  existing.mcpServers[serverName] = serverConfig;
  fs.writeFileSync(existingPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  console.log(`- Updated ${existingPath} → mcpServers.${serverName}`);
}

function registerCursorConfig(pluginDir, cursorHome) {
  fs.mkdirSync(cursorHome, { recursive: true });

  const hooksOut = path.join(cursorHome, 'hooks.json');
  const renderedHooks = renderTemplate(
    path.join(pluginDir, '.cursor/hooks.json'),
    pluginDir,
  );
  mergeHooksConfig(hooksOut, renderedHooks);

  const commandsSrc = path.join(pluginDir, '.cursor/commands');
  if (fs.existsSync(commandsSrc)) {
    const commandsOut = path.join(cursorHome, 'commands');
    fs.mkdirSync(commandsOut, { recursive: true });
    fs.cpSync(commandsSrc, commandsOut, { recursive: true, force: true });
    console.log(`- Wrote ${commandsOut}/ (slash commands)`);
  }

  const mcpOut = path.join(cursorHome, 'mcp.json');
  const renderedMcp = renderTemplate(
    path.join(pluginDir, 'mcp.json'),
    pluginDir,
  );
  if (fs.existsSync(mcpOut)) {
    mergeMcpConfig(mcpOut, renderedMcp);
  } else {
    fs.writeFileSync(mcpOut, renderedMcp, 'utf8');
    console.log(`- Wrote ${mcpOut}`);
  }
}

function printPostInstall(isLocal) {
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart Cursor (Developer: Reload Window).');
  console.log('  2. Command palette → "Cursor: Review Hooks" → trust transcodes-guard.');
  console.log('  3. Save your token: npm install -g @bigstrider/transcodes-cli && transcodes');
  console.log('  4. Use the local IDE Agent (not Cloud Agent) for gate testing.');
  if (!isLocal) {
    console.log(
      '  5. If ~/.cursor/cli-config.json has approvalMode "unrestricted", switch to "allowlist"',
    );
    console.log(
      '     and remove pre-approved Shell/MCP entries you want the gate to intercept.',
    );
  }
  console.log('');
  console.log('Re-run this installer to update in place.');
}

const isLocal = process.argv.slice(2).includes('--local');

const pluginTarget = isLocal
  ? path.resolve(process.cwd(), '.cursor/plugins/transcodes-guard')
  : resolveHome('~/.cursor/plugins/local/transcodes-guard');

const cursorHome = isLocal
  ? path.resolve(process.cwd(), '.cursor')
  : resolveHome('~/.cursor');

console.log('Starting Cursor transcodes-guard plugin installation...');
console.log(`Installing plugin to: ${pluginTarget}`);

fs.mkdirSync(pluginTarget, { recursive: true });

const distDest = path.join(pluginTarget, 'dist');
if (fs.existsSync(distDest)) {
  fs.rmSync(distDest, { recursive: true, force: true });
  console.log(`- Removed stale ${distDest}/ before copy`);
}

for (const item of filesToCopy) {
  const srcPath = path.resolve(__dirname, item);
  const destPath = path.join(pluginTarget, item);
  if (fs.existsSync(srcPath)) {
    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
  } else {
    console.warn(`Warning: Source "${item}" not found — run npm run build:plugin first.`);
  }
}

rewritePluginRoot(path.join(pluginTarget, '.cursor/hooks.json'), pluginTarget);
rewritePluginRoot(path.join(pluginTarget, 'mcp.json'), pluginTarget);

console.log(`Registering user hooks under: ${cursorHome}`);
registerCursorConfig(pluginTarget, cursorHome);

console.log('');
console.log('Cursor transcodes-guard plugin installation completed successfully!');
printPostInstall(isLocal);
