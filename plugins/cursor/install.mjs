#!/usr/bin/env node
/**
 * Cursor IDE plugin installer.
 *
 * Replaces the plugin directory with the committed bundle (dist/, configs),
 * rewrites ${CURSOR_PLUGIN_ROOT} to absolute paths, and registers user-level
 * ~/.cursor/hooks.json and mcp.json (merge-aware — only transcodes-guard entries
 * are upserted; other user hooks / MCP servers are preserved).
 *
 * Re-run for in-place updates — stale files from a prior partial copy are removed
 * automatically. Use a /tmp clone for the one-liner; do not run from a source tree
 * that lives under the install target.
 *
 * Does NOT touch ~/.transcodes/ (token, step-up state, policy cache) — only
 * the Cursor plugin bundle and hook/MCP wiring under ~/.cursor/.
 *
 * Global install also enforces gate-friendly Cursor CLI settings in
 * ~/.cursor/cli-config.json (approvalMode allowlist; removes broad Shell/Mcp
 * allow entries that skip hooks). --local applies the same to <cwd>/.cursor/cli.json.
 * Antigravity has no equivalent host config file — see plugins/antigravity/install.mjs.
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

function pathsOverlap(left, right) {
  return (
    left === right ||
    left.startsWith(`${right}${path.sep}`) ||
    right.startsWith(`${left}${path.sep}`)
  );
}

function validateInstallSources(sourceDir) {
  const missing = filesToCopy.filter(
    (item) => !fs.existsSync(path.resolve(sourceDir, item)),
  );
  if (missing.length === 0) return;

  console.error('');
  console.error(`Error: install bundle incomplete in ${sourceDir}.`);
  console.error(`Missing: ${missing.join(', ')}`);
  console.error(
    'Use a full repo clone with committed dist/, or run npm run build:plugin in the monorepo.',
  );
  process.exit(1);
}

function assertSafeInstallTarget(targetDir, sourceRoot) {
  if (fs.existsSync(targetDir)) {
    const stat = fs.lstatSync(targetDir);
    if (stat.isSymbolicLink()) {
      console.error('');
      console.error(`Error: install target is a symbolic link: ${targetDir}`);
      console.error('Remove or repoint the symlink manually, then re-run this installer.');
      process.exit(1);
    }
  }

  const targetRoot = fs.existsSync(targetDir)
    ? fs.realpathSync(targetDir)
    : path.resolve(targetDir);

  if (pathsOverlap(sourceRoot, targetRoot)) {
    console.error('');
    console.error('Error: install target overlaps this plugin source tree.');
    console.error(
      'Do not run install.mjs from a repo copy living under the install target.',
    );
    console.error(
      'Use: git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/cursor/install.mjs',
    );
    process.exit(1);
  }
}

function rewritePluginRoot(configPath, pluginDir) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Expected config missing after copy: ${configPath}`);
  }
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

/** Allow tokens that bypass beforeShellExecution / beforeMCPExecution entirely. */
const BROAD_GATE_BYPASS_ALLOW = [
  /^Shell\(\*\)$/i,
  /^Shell\(\*\*\)$/i,
  /^Mcp\(\*\)$/i,
  /^Mcp\(\*\:\*\)$/i,
];

function isBroadGateBypassAllow(entry) {
  if (typeof entry !== 'string') return false;
  const trimmed = entry.trim();
  return BROAD_GATE_BYPASS_ALLOW.some((pattern) => pattern.test(trimmed));
}

function isShellOrMcpAllow(entry) {
  if (typeof entry !== 'string') return false;
  const trimmed = entry.trim();
  return /^Shell\(/i.test(trimmed) || /^Mcp\(/i.test(trimmed);
}

/**
 * Force gate-friendly Cursor CLI settings. Parses failures are warn-only.
 * Returns true when the file was rewritten.
 */
function applyCursorCliGateSettings(configPath) {
  if (!fs.existsSync(configPath)) return false;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    console.warn(`Warning: Could not parse ${configPath} — skipping CLI gate settings.`);
    return false;
  }

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    console.warn(`Warning: Unexpected ${configPath} shape — skipping CLI gate settings.`);
    return false;
  }

  let changed = false;

  if (config.approvalMode === 'unrestricted') {
    config.approvalMode = 'allowlist';
    changed = true;
    console.log(`- Set approvalMode to "allowlist" in ${configPath} (was unrestricted)`);
  }

  if (!config.permissions || typeof config.permissions !== 'object') {
    config.permissions = {};
  }
  if (!Array.isArray(config.permissions.allow)) {
    config.permissions.allow = [];
  }

  const before = config.permissions.allow.length;
  config.permissions.allow = config.permissions.allow.filter(
    (entry) => !isBroadGateBypassAllow(entry),
  );
  const removed = before - config.permissions.allow.length;
  if (removed > 0) {
    changed = true;
    console.log(
      `- Removed ${removed} broad Shell/Mcp allow entry(ies) from ${configPath} (they bypass gate hooks)`,
    );
  }

  const remainingShellMcp = config.permissions.allow.filter(isShellOrMcpAllow);
  if (remainingShellMcp.length > 0) {
    console.warn('');
    console.warn(`Warning: ${configPath} still has ${remainingShellMcp.length} Shell/Mcp allow entry(ies).`);
    console.warn('Those commands may run without beforeShellExecution / beforeMCPExecution.');
    console.warn('Remove any you want transcodes-guard to intercept.');
  }

  if (!changed) return false;

  if (typeof config.version !== 'number') {
    config.version = 1;
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return true;
}

function enforceCursorCliGateSettings(isLocal, cursorHome) {
  const configPaths = isLocal
    ? [path.join(cursorHome, 'cli.json')]
    : [resolveHome('~/.cursor/cli-config.json')];

  for (const configPath of configPaths) {
    applyCursorCliGateSettings(configPath);
  }
}

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

  const hadExisting = Object.hasOwn(existing.mcpServers, serverName);
  existing.mcpServers[serverName] = serverConfig;
  fs.writeFileSync(existingPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  if (hadExisting) {
    console.log(`- Updated existing MCP server in ${existingPath} → mcpServers.${serverName}`);
  } else {
    console.log(`- Registered new MCP server in ${existingPath} → mcpServers.${serverName}`);
  }
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
  const renderedMcp = renderTemplate(path.join(pluginDir, 'mcp.json'), pluginDir);
  if (fs.existsSync(mcpOut)) {
    mergeMcpConfig(mcpOut, renderedMcp);
  } else {
    fs.writeFileSync(mcpOut, renderedMcp, 'utf8');
    console.log(`- Wrote ${mcpOut}`);
  }
}

function installPluginBundle(targetDir, sourceDir) {
  const sourceRoot = fs.realpathSync(sourceDir);
  validateInstallSources(sourceDir);
  assertSafeInstallTarget(targetDir, sourceRoot);

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  const stagingDir = fs.mkdtempSync(
    path.join(path.dirname(targetDir), '.transcodes-guard-cursor-install-'),
  );

  try {
    for (const item of filesToCopy) {
      const srcPath = path.resolve(sourceDir, item);
      const destPath = path.join(stagingDir, item);
      fs.cpSync(srcPath, destPath, { recursive: true, force: true });
    }

    rewritePluginRoot(path.join(stagingDir, '.cursor/hooks.json'), stagingDir);
    rewritePluginRoot(path.join(stagingDir, 'mcp.json'), stagingDir);

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      console.log(`- Removed stale ${targetDir}/ before install`);
    }

    fs.renameSync(stagingDir, targetDir);
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    console.error('');
    console.error('Error: Cursor plugin bundle installation failed.');
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
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
      '  5. Review ~/.cursor/cli-config.json — installer sets approvalMode allowlist and',
    );
    console.log(
      '     removes broad Shell(*)/Mcp(*) allows; narrow Shell/Mcp allows may still bypass hooks.',
    );
  } else {
    console.log(
      '  5. Review .cursor/cli.json — same gate-friendly CLI settings applied when present.',
    );
  }
  console.log('');
  console.log('Re-run this installer to update in place.');
}

const isLocal = process.argv.includes('--local');

const pluginTarget = isLocal
  ? path.resolve(process.cwd(), '.cursor/plugins/transcodes-guard')
  : resolveHome('~/.cursor/plugins/local/transcodes-guard');

const cursorHome = isLocal
  ? path.resolve(process.cwd(), '.cursor')
  : resolveHome('~/.cursor');

console.log('Starting Cursor transcodes-guard plugin installation...');
console.log(`Installing plugin to: ${pluginTarget}`);

try {
  installPluginBundle(pluginTarget, __dirname);
  console.log(`Registering user hooks under: ${cursorHome}`);
  registerCursorConfig(pluginTarget, cursorHome);
  console.log('Applying gate-friendly Cursor CLI settings...');
  enforceCursorCliGateSettings(isLocal, cursorHome);
} catch (error) {
  console.error('');
  console.error('Error: Cursor transcodes-guard plugin installation failed.');
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}

console.log('');
console.log('Cursor transcodes-guard plugin installation completed successfully!');
printPostInstall(isLocal);
