/**
 * Best-effort detection of AI host products on this machine.
 * Shared by `transcodes install` (menu hints) and `transcodes sync generate`
 * (default --targets when -t is omitted).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RulesProcessor } from '../sync/features/rules/rules-processor.js';
import {
  type RulesyncTargets,
  RulesyncTargetsSchema,
  type ToolTarget,
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
  const vendorBins = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'bin'),
    path.join(home, '.codex', 'bin'),
    path.join(home, '.cursor', 'bin'),
    path.join(home, '.gemini', 'bin'),
    path.join(home, 'bin'),
  ];
  const extras =
    process.platform === 'win32'
      ? [
          // `npm -g` writes its .cmd shims here. A GUI-launched process often
          // carries a stale PATH that predates the npm prefix, which made every
          // host CLI look uninstalled.
          path.join(
            process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
            'npm',
          ),
          path.join(
            process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
            'Programs',
            'nodejs',
          ),
          // Where the vendor installers drop agy.exe / agent.exe. Their
          // documented #1 failure mode is the user PATH never picking these up.
          path.join(
            process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
            'agy',
            'bin',
          ),
          path.join(
            process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
            'cursor-agent',
          ),
          path.join(
            process.env.PROGRAMFILES ?? 'C:\\Program Files',
            'Git',
            'cmd',
          ),
          ...vendorBins,
        ]
      : [...vendorBins, '/usr/local/bin', '/opt/homebrew/bin'];
  // The Node runtime executing this CLI always exists; on Windows its
  // directory also holds npm/npx.
  extras.unshift(path.dirname(process.execPath));
  const current = process.env.PATH ?? '';
  const parts = current.split(path.delimiter).filter(Boolean);
  const merged = [...extras.filter((p) => !parts.includes(p)), ...parts];
  process.env.PATH = merged.join(path.delimiter);
}

/** Sync PATH lookup (menu render must stay synchronous). */
export function commandExistsSync(cmd: string): boolean {
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
const HOST_CONFIG_DIRS: Record<HostPlatformId, string> = {
  claude: '.claude',
  codex: '.codex',
  cursor: '.cursor',
  antigravity: '.gemini',
};

/**
 * Sync rule targets that support `--global` (user-scope Instruction/Rules).
 * Cursor is excluded: rulesync `cursor` has `supportsGlobal: false`.
 */
export function getGlobalPersonaSyncTargets(): ToolTarget[] {
  const globalRuleTargets = new Set(
    RulesProcessor.getToolTargets({ global: true }),
  );
  return ALL_HOST_PLATFORMS.map(
    (id) => HOST_TO_SYNC_TARGET[id] as ToolTarget,
  ).filter((target) => globalRuleTargets.has(target));
}

export function hostSupportsGlobalPersona(id: HostPlatformId): boolean {
  return getGlobalPersonaSyncTargets().includes(
    HOST_TO_SYNC_TARGET[id] as ToolTarget,
  );
}

/**
 * Detect host config roots under the home directory for Persona `--global`.
 * Only includes hosts whose rulesync rules target supports user-scope output.
 */
export function detectInstalledHostConfigTargets(): {
  root: string;
  hosts: HostPlatformId[];
  targets: string[];
} {
  const home = path.resolve(os.homedir());
  const hosts: HostPlatformId[] = [];
  for (const id of ALL_HOST_PLATFORMS) {
    if (!hostSupportsGlobalPersona(id)) continue;
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
