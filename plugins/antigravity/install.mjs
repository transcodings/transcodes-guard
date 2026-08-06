#!/usr/bin/env node
/**
 * Google Antigravity plugin installer.
 *
 * Replaces the entire plugin directory with the committed bundle (dist/, configs,
 * rules, skills), moves it into place, then rewrites __PLUGIN_DIR__ in every
 * placeholder config at the final install path (rename-before-rewrite — staging
 * paths are never baked in). Antigravity has no plugin-root env var, so paths
 * must be injected at install time. Re-run for in-place updates.
 *
 * Installs only to ~/.gemini/config/plugins/transcodes-guard (or --local workspace
 * copy). Does NOT register user-level hook/MCP files — other Antigravity plugins
 * under ~/.gemini/config/plugins/ are untouched.
 *
 * Does NOT touch ~/.transcodes/ (token, step-up state, policy cache).
 *
 * Global install only: removes stale `source: "claude-code"` transcodes-guard rows
 * from ~/.gemini/config/import_manifest.json (leftovers from `agy plugin install`
 * on this monorepo). Does not synthesize new manifest entries. `--local` never
 * touches the global manifest.
 *
 * Global install also enforces gate-friendly agy CLI settings in
 * ~/.gemini/antigravity-cli/settings.json when present (`toolPermission`
 * request-review; removes broad command/mcp/unsandboxed allow entries).
 * Desktop app Terminal Turbo/Allow list is UI-only — not modified here.
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

const PLUGIN_NAME = 'transcodes-guard';
/** Only remove entries we know `agy plugin install` adds for the wrong host adapter. */
const STALE_IMPORT_SOURCES = new Set(['claude-code']);

const PLACEHOLDER = '__PLUGIN_DIR__';
/** Every committed config that bakes plugin-root paths at install time. */
const PLACEHOLDER_CONFIGS = ['hooks.json', 'mcp_config.json'];
const STAGING_DIR_PATTERN = /\.transcodes-guard-install-/;
/** Bundled artifacts — not install-time placeholder configs. */
const PLACEHOLDER_SCAN_SKIP_DIRS = new Set(['dist', 'node_modules']);

function toPosix(dir) {
  return dir.split(path.sep).join('/');
}

function toPosixRel(rootDir, filePath) {
  return toPosix(path.relative(rootDir, filePath));
}

function collectJsonFilesRecursive(dir, rootDir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    const stat = fs.lstatSync(entryPath);
    if (stat.isDirectory()) {
      if (PLACEHOLDER_SCAN_SKIP_DIRS.has(entry)) continue;
      collectJsonFilesRecursive(entryPath, rootDir, out);
      continue;
    }
    if (!entry.endsWith('.json')) continue;
    out.push({ rel: toPosixRel(rootDir, entryPath), abs: entryPath });
  }
  return out;
}

/** Fine-grained allow tokens that auto-approve without review (antigravity.google/docs/cli/permissions). */
const BROAD_GATE_BYPASS_ALLOW = [
  /^command\(\*\)$/i,
  /^mcp\(\*\)$/i,
  /^unsandboxed\(\*\)$/i,
];

const GATE_RELEVANT_ALLOW_PREFIX = /^(command|mcp|unsandboxed)\(/i;

function isBroadGateBypassAllow(entry) {
  if (typeof entry !== 'string') return false;
  const trimmed = entry.trim();
  return BROAD_GATE_BYPASS_ALLOW.some((pattern) => pattern.test(trimmed));
}

function isGateRelevantAllow(entry) {
  if (typeof entry !== 'string') return false;
  return GATE_RELEVANT_ALLOW_PREFIX.test(entry.trim());
}

/**
 * Force gate-friendly agy CLI settings. Missing file or parse errors are warn-only.
 * Returns true when the file was rewritten.
 */
function applyAntigravityCliGateSettings(configPath) {
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

  if (config.toolPermission === 'always-proceed') {
    config.toolPermission = 'request-review';
    changed = true;
    console.log(
      `- Set toolPermission to "request-review" in ${configPath} (was always-proceed)`,
    );
  }

  if (config.toolPermission === 'proceed-in-sandbox') {
    console.warn('');
    console.warn(`Warning: ${configPath} has toolPermission "proceed-in-sandbox".`);
    console.warn('Sandboxed runs may auto-approve tools — use "request-review" if hooks feel skipped.');
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
      `- Removed ${removed} broad command/mcp/unsandboxed allow entry(ies) from ${configPath}`,
    );
  }

  const remaining = config.permissions.allow.filter(isGateRelevantAllow);
  if (remaining.length > 0) {
    console.warn('');
    console.warn(
      `Warning: ${configPath} still has ${remaining.length} command/mcp/unsandboxed allow entry(ies).`,
    );
    console.warn('Those operations skip the agy permission prompt — review any you want gated.');
  }

  if (!changed) return false;

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return true;
}

function enforceAntigravityCliGateSettings(isLocal) {
  if (isLocal) return;
  applyAntigravityCliGateSettings(
    resolveHome('~/.gemini/antigravity-cli/settings.json'),
  );
}

function resolveHome(filepath) {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
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

function assertSourcePlaceholderCoverage(sourceDir) {
  const listed = new Set(PLACEHOLDER_CONFIGS);

  for (const rel of PLACEHOLDER_CONFIGS) {
    const configPath = path.join(sourceDir, rel);
    if (!fs.existsSync(configPath)) {
      throw new Error(`Expected placeholder config missing in bundle: ${rel}`);
    }
    if (!fs.readFileSync(configPath, 'utf8').includes(PLACEHOLDER)) {
      throw new Error(`${rel} is missing ${PLACEHOLDER} — config format changed.`);
    }
  }

  for (const { rel, abs } of collectJsonFilesRecursive(sourceDir, sourceDir)) {
    const content = fs.readFileSync(abs, 'utf8');
    if (content.includes(PLACEHOLDER) && !listed.has(rel)) {
      throw new Error(
        `Found ${PLACEHOLDER} in ${rel} but it is not listed in PLACEHOLDER_CONFIGS — update install.mjs.`,
      );
    }
  }
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
      'Do not run install.mjs from a repo copy living under the install target (e.g. agy plugin install leftovers).',
    );
    console.error(
      'Use: git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/antigravity/install.mjs',
    );
    process.exit(1);
  }
}

function rewritePluginDir(configPath, targetDir) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Expected config missing after install: ${configPath}`);
  }
  const pluginDir = toPosix(path.resolve(targetDir));
  const content = fs.readFileSync(configPath, 'utf8');
  if (!content.includes(PLACEHOLDER)) {
    throw new Error(
      `${PLACEHOLDER} placeholder not found in ${configPath} — config format changed; update install.mjs.`,
    );
  }
  fs.writeFileSync(
    configPath,
    content.split(PLACEHOLDER).join(pluginDir),
    'utf8',
  );
  console.log(
    `- Baked ${PLACEHOLDER} → ${pluginDir} in ${path.relative(targetDir, configPath) || path.basename(configPath)}`,
  );
}

function rewriteAllPluginConfigs(targetDir) {
  for (const rel of PLACEHOLDER_CONFIGS) {
    rewritePluginDir(path.join(targetDir, rel), targetDir);
  }
}

function assertInstalledPluginPaths(targetDir) {
  const pluginRoot = toPosix(path.resolve(targetDir));

  for (const rel of PLACEHOLDER_CONFIGS) {
    const configPath = path.join(targetDir, rel);
    const content = fs.readFileSync(configPath, 'utf8');
    if (content.includes(PLACEHOLDER)) {
      throw new Error(`${rel} still contains ${PLACEHOLDER} after install.`);
    }
    if (STAGING_DIR_PATTERN.test(content)) {
      throw new Error(`${rel} still references a staging install directory.`);
    }
    if (!content.includes(pluginRoot)) {
      throw new Error(`${rel} does not reference the installed plugin root.`);
    }
  }

  const stdioPath = path.join(targetDir, 'dist/src/stdio.js');
  if (!fs.existsSync(stdioPath)) {
    throw new Error(`MCP entry missing after install: ${stdioPath}`);
  }

  const mcpConfig = JSON.parse(
    fs.readFileSync(path.join(targetDir, 'mcp_config.json'), 'utf8'),
  );
  const stdioArg = mcpConfig.mcpServers?.[PLUGIN_NAME]?.args?.[0];
  if (typeof stdioArg !== 'string' || !stdioArg.startsWith(pluginRoot)) {
    throw new Error(
      `mcp_config.json must point stdio.js under ${pluginRoot} (got ${stdioArg ?? 'missing'}).`,
    );
  }

  console.log(`- Verified MCP stdio entry: ${stdioArg}`);
}

function isStaleTranscodesGuardImport(entry) {
  return entry?.name === PLUGIN_NAME && STALE_IMPORT_SOURCES.has(entry?.source);
}

function sanitizeImportManifest() {
  const manifestPath = resolveHome('~/.gemini/config/import_manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    console.warn(`Warning: Could not parse ${manifestPath} — skipping import cleanup.`);
    return;
  }

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    console.warn(
      `Warning: Unexpected ${manifestPath} shape — skipping import cleanup.`,
    );
    return;
  }

  const imports = Array.isArray(manifest.imports) ? manifest.imports : [];
  const kept = imports.filter((entry) => !isStaleTranscodesGuardImport(entry));
  const removed = imports.length - kept.length;
  if (removed === 0) return;

  manifest.imports = kept;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    `- Removed ${removed} stale source=claude-code transcodes-guard import(s) from ${manifestPath}`,
  );
}

function installToTarget(targetDir, sourceDir) {
  const sourceRoot = fs.realpathSync(sourceDir);
  validateInstallSources(sourceDir);
  assertSourcePlaceholderCoverage(sourceDir);
  assertSafeInstallTarget(targetDir, sourceRoot);

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  const stagingDir = fs.mkdtempSync(
    path.join(path.dirname(targetDir), '.transcodes-guard-install-'),
  );

  try {
    for (const item of filesToCopy) {
      const srcPath = path.resolve(sourceDir, item);
      const destPath = path.join(stagingDir, item);
      fs.cpSync(srcPath, destPath, { recursive: true, force: true });
    }

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      console.log(`- Removed stale ${targetDir}/ before install`);
    }

    // Rename first, then rewrite at the final location (staging paths never baked in).
    fs.renameSync(stagingDir, targetDir);
    rewriteAllPluginConfigs(targetDir);
    assertInstalledPluginPaths(targetDir);
  } catch (error) {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      console.error(`- Rolled back incomplete install at ${targetDir}/`);
    }
    console.error('');
    console.error('Error: Antigravity plugin installation failed.');
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

function printPostInstall(isLocal) {
  console.log('');
  console.log('Next steps:');
  if (isLocal) {
    console.log('  1. Restart Antigravity in this workspace.');
  } else {
    console.log('  1. Restart Antigravity desktop app and/or `agy` CLI session.');
    console.log(
      '  2. Confirm: `agy plugin list` no longer shows a duplicate source=claude-code entry.',
    );
  }
  console.log('  3. Save your token: curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes  (Windows: Set-ExecutionPolicy Bypass -Scope Process -Force; irm …/install.ps1 | iex)');
  if (!isLocal) {
    console.log(
      '  4. Review ~/.gemini/antigravity-cli/settings.json — installer sets toolPermission',
    );
    console.log(
      '     request-review and removes broad command(*)/mcp(*) allows when the file exists.',
    );
    console.log(
      '  5. Desktop app: Settings → Advanced → Terminal — avoid Turbo unless Deny list is tight.',
    );
  }
  console.log('');
  console.log('Re-run this installer to update in place.');
  console.log('Do not use `agy plugin install` on this monorepo — it skips __PLUGIN_DIR__ rewrite.');
  console.log('Do not launch agy with --dangerously-skip-permissions — it bypasses permission checks.');
}

const isLocal = process.argv.includes('--local');

const targetDirs = isLocal
  ? [path.resolve(process.cwd(), '.agents/plugins/transcodes-guard')]
  : [resolveHome('~/.gemini/config/plugins/transcodes-guard')];

console.log('Starting Google Antigravity transcodes-guard plugin installation...');

for (const targetDir of targetDirs) {
  console.log(`Installing to: ${targetDir}`);
  installToTarget(targetDir, __dirname);
}

if (!isLocal) {
  sanitizeImportManifest();
  console.log('Applying gate-friendly agy CLI settings...');
  enforceAntigravityCliGateSettings(isLocal);
}

console.log('');
console.log('Google Antigravity transcodes-guard plugin installation completed successfully!');
printPostInstall(isLocal);
