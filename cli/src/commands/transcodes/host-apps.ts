/**
 * Best-effort detection of AI host products on this machine.
 * Shared by `transcodes install` (menu hints) and `transcodes sync generate`
 * (default --targets when -t is omitted).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  type RulesyncTargets,
  RulesyncTargetsSchema,
} from '../sync/types/tool-targets.js';

export type HostPlatformId = 'claude' | 'codex' | 'cursor' | 'antigravity';

/** CLI binaries that count as "host present" for each platform. */
export const HOST_CLI_BINARIES: Record<HostPlatformId, readonly string[]> = {
  claude: ['claude'],
  codex: ['codex'],
  cursor: ['cursor-agent', 'agent', 'cursor'],
  antigravity: ['agy'],
};

const ALL_HOST_PLATFORMS: readonly HostPlatformId[] = [
  'claude',
  'codex',
  'cursor',
  'antigravity',
];

/** Map install/host platform → sync generate target id. */
const HOST_TO_SYNC_TARGET: Record<HostPlatformId, string> = {
  claude: 'claudecode',
  codex: 'codexcli',
  cursor: 'cursor',
  antigravity: 'antigravity-ide',
};

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Prepend common vendor bin dirs so freshly installed CLIs are visible. */
export function refreshPathHints(): void {
  const home = os.homedir();
  const extras = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'bin'),
    path.join(home, '.codex', 'bin'),
    path.join(home, '.cursor', 'bin'),
    path.join(home, '.gemini', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  const current = process.env.PATH ?? '';
  const parts = current.split(path.delimiter).filter(Boolean);
  const merged = [...extras.filter((p) => !parts.includes(p)), ...parts];
  process.env.PATH = merged.join(path.delimiter);
}

function commandExistsSync(cmd: string): boolean {
  const pathEnv = process.env.PATH ?? '';
  const exts =
    process.platform === 'win32' ? ['.exe', '.cmd', '.bat', '.ps1', ''] : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (safeExists(path.join(dir, `${cmd}${ext}`))) return true;
    }
  }
  return false;
}

function hostDesktopPresent(id: HostPlatformId): boolean {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const candidates: Record<HostPlatformId, readonly string[]> = {
      claude: [
        '/Applications/Claude.app',
        '/Applications/Claude Code.app',
        path.join(home, 'Applications', 'Claude.app'),
        path.join(home, 'Applications', 'Claude Code.app'),
      ],
      cursor: [
        '/Applications/Cursor.app',
        path.join(home, 'Applications', 'Cursor.app'),
      ],
      codex: [
        '/Applications/ChatGPT.app',
        '/Applications/Codex.app',
        path.join(home, 'Applications', 'ChatGPT.app'),
        path.join(home, 'Applications', 'Codex.app'),
      ],
      antigravity: [
        '/Applications/Antigravity.app',
        '/Applications/Google Antigravity.app',
        path.join(home, 'Applications', 'Antigravity.app'),
        path.join(home, 'Applications', 'Google Antigravity.app'),
      ],
    };
    return candidates[id].some(safeExists);
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? '';
    const prog = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const candidates: Record<HostPlatformId, readonly string[]> = {
      claude: [
        path.join(local, 'Programs', 'Claude', 'Claude.exe'),
        path.join(local, 'AnthropicClaude', 'claude.exe'),
      ],
      cursor: [
        path.join(local, 'Programs', 'cursor', 'Cursor.exe'),
        path.join(prog, 'Cursor', 'Cursor.exe'),
      ],
      codex: [
        path.join(local, 'Programs', 'ChatGPT', 'ChatGPT.exe'),
        path.join(local, 'Programs', 'codex', 'Codex.exe'),
      ],
      antigravity: [
        path.join(local, 'Programs', 'Antigravity', 'Antigravity.exe'),
        path.join(local, 'Programs', 'Google Antigravity', 'Antigravity.exe'),
      ],
    };
    return candidates[id].some(safeExists);
  }
  return false;
}

/** Is the host product on this machine (CLI on PATH and/or desktop app)? */
export function isHostAppInstalled(id: HostPlatformId): boolean {
  refreshPathHints();
  if (HOST_CLI_BINARIES[id].some(commandExistsSync)) return true;
  return hostDesktopPresent(id);
}

export function detectInstalledHostPlatforms(): HostPlatformId[] {
  return ALL_HOST_PLATFORMS.filter((id) => isHostAppInstalled(id));
}

/** Home-level config dirs used when applying a Persona without a project. */
const HOST_CONFIG_DIRS: Record<Exclude<HostPlatformId, 'codex'>, string> = {
  claude: '.claude',
  cursor: '.cursor',
  antigravity: '.gemini',
};

/**
 * Detect Claude / Cursor / Antigravity config roots under the home directory.
 * Used to apply a Persona globally on this device for every project/session.
 */
export function detectInstalledHostConfigTargets(): {
  root: string;
  hosts: Array<Exclude<HostPlatformId, 'codex'>>;
  targets: string[];
} {
  const home = path.resolve(os.homedir());
  const hosts: Array<Exclude<HostPlatformId, 'codex'>> = [];
  for (const id of ['claude', 'cursor', 'antigravity'] as const) {
    const configDir = path.join(home, HOST_CONFIG_DIRS[id]);
    if (safeExists(configDir) || isHostAppInstalled(id)) {
      hosts.push(id);
    }
  }
  return {
    root: home,
    hosts,
    targets: hosts.map((id) => HOST_TO_SYNC_TARGET[id]),
  };
}

/**
 * Sync generate targets from installed hosts.
 * Always includes `agentsmd` (AGENTS.md). If nothing is detected, returns
 * only `agentsmd`.
 */
export function detectSyncTargets(): RulesyncTargets {
  const hosts = detectInstalledHostPlatforms();
  const targets = [...hosts.map((id) => HOST_TO_SYNC_TARGET[id]), 'agentsmd'];
  return RulesyncTargetsSchema.parse([...new Set(targets)]);
}
