/**
 * `transcodes install` — one interactive flow that installs the host plugins,
 * then opens the dashboard (sign-in happens there, or via `transcodes login`).
 *
 * The published CLI package ships only `dist/` (no plugin bundles), so this
 * command orchestrates the SAME mechanisms the README documents:
 *   - Claude Code / Codex: their native host CLIs (`claude` / `codex`).
 *   - Cursor / Antigravity: a temp `git clone` + the committed `install.mjs`.
 *
 * Before each plugin install it ensures the host CLI is on PATH (installs it
 * if missing). Node.js LTS (>= 20) is checked first.
 *
 * Nothing here duplicates the gate; it only wires hosts. Authentication is
 * left to the dashboard / `transcodes login`.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface, moveCursor } from 'node:readline';
import { ensureDashboard } from './dashboard-lifecycle.js';
import {
  commandExistsSync,
  isHostAppInstalled,
  refreshPathHints,
} from './host-apps.js';
import { readSavedLocale, setLocale, t } from './i18n.js';
import { CLI_PACKAGE_NAME, CLI_VERSION } from './version.js';

const REPO_SLUG = 'transcodings/transcodes-guard';
const REPO_GIT_URL = 'https://github.com/transcodings/transcodes-guard.git';
const MARKETPLACE = 'bigstrider';
const PLUGIN_NAME = 'transcodes-guard';
/** Matches package engines + host plugin requirements. */
const MIN_NODE_MAJOR = 20;

type PlatformId = 'claude' | 'codex' | 'cursor' | 'antigravity';

type Platform = {
  id: PlatformId;
  label: string;
  /** Where the plugin bundle lives inside a repo clone (cursor/antigravity only). */
  installerRel?: string;
};

type HostCliSpec = {
  /** Any of these binaries counts as "CLI present". */
  binaries: readonly string[];
  label: string;
  /** Official install — prefers each vendor's documented one-liner. */
  install: () => Promise<boolean>;
};

const PLATFORMS: readonly Platform[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'ChatGPT (Codex)' },
  {
    id: 'cursor',
    label: 'Cursor',
    installerRel: 'plugins/cursor/install.mjs',
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    installerRel: 'plugins/antigravity/install.mjs',
  },
];

const IS_WINDOWS = process.platform === 'win32';

/**
 * `shell: true` on Windows hands the string to `cmd.exe` without escaping, so
 * anything with spaces or cmd metacharacters must be quoted by us.
 */
function quoteWinArg(arg: string): string {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** Clear the terminal so the next screen starts at the top. */
function clearScreen(): void {
  // CSI 2J = erase display, CSI H = cursor home. Works in most IDE TTYs.
  process.stdout.write('\x1b[2J\x1b[H');
}

/**
 * Terminal display columns for a string. Hangul/CJK glyphs are double-width,
 * so `string.length` undercounts and in-place menu redraws overlap when lines
 * wrap (the bug that mashed Korean platform-select headers together).
 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Physical terminal rows a list of logical lines will occupy (wrap-aware). */
function physicalRowCount(lines: readonly string[]): number {
  const cols = Math.max(1, process.stdout.columns || 80);
  let rows = 0;
  for (const line of lines) {
    const w = Math.max(1, displayWidth(line));
    rows += Math.ceil(w / cols);
  }
  return rows;
}

/**
 * Redraw a multi-line block in place. Uses wrap-aware row counts + clear-to-
 * end-of-screen so CJK-wrapped lines do not leave garbage above the menu.
 */
function redrawBlock(
  stdout: NodeJS.WriteStream,
  lines: readonly string[],
  previousPhysicalRows: number,
): number {
  if (previousPhysicalRows > 0) {
    moveCursor(stdout, 0, -previousPhysicalRows);
    // CSI J = erase from cursor to end of screen (drops stale wrapped rows).
    stdout.write('\x1b[J');
  }
  stdout.write(`${lines.map((line) => `${line}\x1b[K`).join('\n')}\n`);
  return physicalRowCount(lines);
}

function isTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Open a URL in the default browser (fire-and-forget). */
function openUrl(url: string): void {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : IS_WINDOWS
        ? (process.env.COMSPEC ?? 'cmd.exe')
        : 'xdg-open';
  const args = IS_WINDOWS ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(opener, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is printed alongside, so a failed launch is non-fatal.
  }
}

/**
 * Resolve whether a command is on PATH.
 *
 * Windows resolves via a direct PATH+PATHEXT scan instead of spawning `where`:
 * `where` is a PowerShell alias for `Where-Object`, and a spawn failure here
 * would silently mark every host CLI as missing.
 */
function commandExists(cmd: string): Promise<boolean> {
  if (IS_WINDOWS) return Promise.resolve(commandExistsSync(cmd));
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', `command -v ${JSON.stringify(cmd)}`], {
      stdio: 'ignore',
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function anyCommandExists(
  cmds: readonly string[],
): Promise<string | null> {
  for (const cmd of cmds) {
    if (await commandExists(cmd)) return cmd;
  }
  return null;
}

/**
 * Run a command with inherited stdio; resolves with the exit code.
 *
 * Windows needs `shell: true`: `npm`, `claude`, `codex` are `.cmd` shims and
 * bare `spawn('npm')` cannot resolve them (ENOENT).
 */
function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    log(`\n$ ${cmd} ${args.join(' ')}`);
    const child = IS_WINDOWS
      ? spawn(quoteWinArg(cmd), args.map(quoteWinArg), {
          stdio: 'inherit',
          env: process.env,
          shell: true,
        })
      : spawn(cmd, args, { stdio: 'inherit', env: process.env });
    child.on('error', (err) => {
      log(`  (failed to start: ${err.message})`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Capture stdout/stderr (used for `npm prefix -g` etc.). */
function runCapture(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = IS_WINDOWS
      ? spawn(quoteWinArg(cmd), args.map(quoteWinArg), {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
          shell: true,
        })
      : spawn(cmd, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        });
    let stdout = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.on('error', () => resolve({ code: 1, stdout }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
  });
}

type NpmInvocation = { cmd: string; baseArgs: string[] };

/**
 * Prefer the npm that ships next to `process.execPath` (the Node running this
 * CLI). PATH `npm` can belong to a different Node and write globals elsewhere —
 * the root cause of `transcodes update` seeming to succeed while the shell
 * still runs an older binary.
 */
function resolveNpmInvocation(): NpmInvocation | null {
  const nodeDir = path.dirname(process.execPath);
  const npmCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (safeExists(npmCli)) {
    return { cmd: process.execPath, baseArgs: [npmCli] };
  }
  if (IS_WINDOWS) {
    for (const name of ['npm.cmd', 'npm.exe', 'npm'] as const) {
      const abs = path.join(nodeDir, name);
      if (safeExists(abs)) return { cmd: abs, baseArgs: [] };
    }
  } else {
    const abs = path.join(nodeDir, 'npm');
    if (safeExists(abs)) return { cmd: abs, baseArgs: [] };
  }
  if (commandExistsSync('npm')) return { cmd: 'npm', baseArgs: [] };
  return null;
}

function pathSegEq(a: string, b: string): boolean {
  return IS_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Global npm prefix that owns the currently executing CLI package.
 *
 * Layouts (npm `prefix -g`):
 *   Windows: `{prefix}/node_modules/@bigstrider/transcodes-cli/…`
 *   Unix:    `{prefix}/lib/node_modules/@bigstrider/transcodes-cli/…`
 *
 * Parent-of-`node_modules` alone is wrong on Unix — that is `…/lib`, and
 * `npm install -g --prefix …/lib` would nest into `…/lib/lib/node_modules`.
 */
function inferGlobalPrefixFromRunningCli(): string | null {
  const entry = process.argv[1];
  if (!entry) return null;
  let resolved = entry;
  try {
    resolved = fs.realpathSync(entry);
  } catch {
    // keep entry (Windows .cmd → js may already be absolute)
  }
  const parts = resolved.split(path.sep);
  for (let i = 0; i < parts.length - 2; i++) {
    if (
      pathSegEq(parts[i] ?? '', 'node_modules') &&
      pathSegEq(parts[i + 1] ?? '', '@bigstrider') &&
      pathSegEq(parts[i + 2] ?? '', 'transcodes-cli')
    ) {
      const parentOfNm = parts.slice(0, i).join(path.sep) || path.sep;
      // Unix global: strip trailing `lib` so prefix matches `npm prefix -g`.
      if (!IS_WINDOWS && path.basename(parentOfNm) === 'lib') {
        const prefix = path.dirname(parentOfNm);
        return prefix || path.sep;
      }
      return parentOfNm;
    }
  }
  return null;
}

/** `package.json` of a global `@bigstrider/transcodes-cli` under an npm prefix. */
function globalCliPackageJson(prefix: string): string | null {
  const candidates = IS_WINDOWS
    ? [
        path.join(
          prefix,
          'node_modules',
          '@bigstrider',
          'transcodes-cli',
          'package.json',
        ),
      ]
    : [
        path.join(
          prefix,
          'lib',
          'node_modules',
          '@bigstrider',
          'transcodes-cli',
          'package.json',
        ),
        // Custom / legacy prefixes sometimes omit the `lib` segment.
        path.join(
          prefix,
          'node_modules',
          '@bigstrider',
          'transcodes-cli',
          'package.json',
        ),
      ];
  for (const p of candidates) {
    if (safeExists(p)) return p;
  }
  return null;
}

function prependPathDir(dir: string): void {
  if (!dir) return;
  const parts = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const filtered = parts.filter((p) =>
    IS_WINDOWS ? p.toLowerCase() !== dir.toLowerCase() : p !== dir,
  );
  process.env.PATH = [dir, ...filtered].join(path.delimiter);
}

/** Persist a dir on the User PATH (Windows) — same idea as install.ps1. */
async function persistUserPathWindows(dir: string): Promise<void> {
  if (!IS_WINDOWS || !dir) return;
  const script = [
    `$dir = ${JSON.stringify(dir)}`,
    `$current = [Environment]::GetEnvironmentVariable('Path', 'User')`,
    '$parts = @()',
    `if ($current) { $parts = $current -split ';' | Where-Object { $_ } }`,
    'if ($parts -notcontains $dir) {',
    `  $new = (@($parts + $dir) -join ';')`,
    `  [Environment]::SetEnvironmentVariable('Path', $new, 'User')`,
    '}',
  ].join('; ');
  await new Promise<void>((resolve) => {
    const child = spawn(
      powerShellExe(),
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: 'ignore', env: process.env },
    );
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

/** Run a POSIX shell one-liner (vendor install scripts: curl | bash). */
function runShell(script: string): Promise<number> {
  if (IS_WINDOWS) {
    log(`\n$ ${script}`);
    log('  (skipped: this installer needs a POSIX shell, unavailable here)');
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    log(`\n$ ${script}`);
    const child = spawn('sh', ['-c', script], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', (err) => {
      log(`  (failed to start: ${err.message})`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/**
 * Absolute path to Windows PowerShell 5.1. Two reasons not to rely on a PATH
 * lookup or on `pwsh`: a stale PATH is the failure mode this module works
 * around, and Cursor's installer calls `Get-WmiObject`, which PowerShell Core
 * 7+ removed.
 */
function powerShellExe(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (systemRoot) {
    const abs = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    if (safeExists(abs)) return abs;
  }
  return 'powershell.exe';
}

/** Run a PowerShell one-liner (Windows vendor install scripts: irm | iex). */
function runPowerShell(script: string): Promise<number> {
  return new Promise((resolve) => {
    log(`\n$ powershell -NoProfile -Command ${script}`);
    const child = spawn(
      powerShellExe(),
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: 'inherit', env: process.env },
    );
    child.on('error', (err) => {
      log(`  (failed to start: ${err.message})`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function runAll(
  steps: readonly { cmd: string; args: string[] }[],
): Promise<boolean> {
  for (const step of steps) {
    const code = await run(step.cmd, step.args);
    if (code !== 0) return false;
  }
  return true;
}

function nodeMajor(version = process.versions.node): number {
  const major = Number(version.split('.')[0]);
  return Number.isFinite(major) ? major : 0;
}

/**
 * Ensure Node.js >= 20 is available. Prefer upgrading via Homebrew / nvm /
 * winget rather than failing silently — Cursor / Antigravity installers and
 * several host CLIs need it.
 */
async function ensureNode(): Promise<boolean> {
  log('── Prerequisites ──');
  refreshPathHints();
  const major = nodeMajor();
  const onPath = await commandExists('node');

  if (major >= MIN_NODE_MAJOR && onPath) {
    log(`  ✓ Node.js v${process.versions.node} (>= ${MIN_NODE_MAJOR})`);
    return true;
  }

  if (major >= MIN_NODE_MAJOR && !onPath) {
    // Running under a Node that somehow isn't on PATH for children — rare.
    log(
      `  ! Node.js v${process.versions.node} is running this CLI but \`node\` is not on PATH.`,
    );
    log('    Prepending common bin dirs and continuing…');
    refreshPathHints();
    if (await commandExists('node')) {
      log('  ✓ Node.js now on PATH');
      return true;
    }
  }

  log(
    major > 0 && major < MIN_NODE_MAJOR
      ? `  Node.js v${process.versions.node} is below ${MIN_NODE_MAJOR} — installing LTS…`
      : '  Node.js not found — installing LTS…',
  );

  let installed = false;

  if (IS_WINDOWS) {
    // winget often exits non-zero even after a successful install (e.g. already
    // present). Always re-check PATH instead of trusting the exit code.
    if (await commandExists('winget')) {
      await run('winget', [
        'install',
        '--id',
        'OpenJS.NodeJS.LTS',
        '-e',
        '--silent',
        '--accept-package-agreements',
        '--accept-source-agreements',
      ]);
      refreshPathHints();
      installed = await commandExists('node');
    }
    if (!installed && (await commandExists('choco'))) {
      await run('choco', ['install', 'nodejs-lts', '-y']);
      refreshPathHints();
      installed = await commandExists('node');
    }
    if (!installed && (await commandExists('scoop'))) {
      await run('scoop', ['install', 'nodejs-lts']);
      refreshPathHints();
      installed = await commandExists('node');
    }
  } else if (process.platform === 'darwin' && (await commandExists('brew'))) {
    installed = (await run('brew', ['install', 'node'])) === 0;
  }

  if (!installed && !IS_WINDOWS && (await commandExists('nvm'))) {
    installed = (await runShell('nvm install --lts && nvm use --lts')) === 0;
  }

  if (!installed && !IS_WINDOWS) {
    // Official nvm bootstrap, then install current LTS into the same shell.
    const nvmInstall = [
      'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash',
      'export NVM_DIR="$HOME/.nvm"',
      '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
      'nvm install --lts',
      'nvm alias default "lts/*"',
    ].join(' && ');
    installed = (await runShell(nvmInstall)) === 0;
  }

  refreshPathHints();
  // nvm puts node under ~/.nvm/versions/node/.../bin — add the default link.
  const nvmDefaultBin = path.join(os.homedir(), '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDefaultBin)) {
    try {
      const versions = fs
        .readdirSync(nvmDefaultBin)
        .filter((v) => v.startsWith('v'))
        .sort()
        .reverse();
      if (versions[0]) {
        const bin = path.join(nvmDefaultBin, versions[0], 'bin');
        process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
      }
    } catch {
      // ignore — commandExists will tell us if it worked
    }
  }

  if (await commandExists('node')) {
    const ver = await new Promise<string>((resolve) => {
      const child = spawn('node', ['-v'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      child.stdout?.on('data', (c: Buffer) => {
        out += c.toString();
      });
      child.on('close', () => resolve(out.trim().replace(/^v/, '')));
      child.on('error', () => resolve(''));
    });
    const installedMajor = nodeMajor(ver || '0');
    if (installedMajor >= MIN_NODE_MAJOR) {
      log(`  ✓ Node.js v${ver} installed`);
      return true;
    }
  }

  log('');
  log('Could not install Node.js LTS automatically.');
  log(
    `Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org then re-run:`,
  );
  log('  transcodes install');
  openUrl('https://nodejs.org');
  return false;
}

/**
 * Ensure `git` is on PATH. Claude/Codex marketplace add and Cursor/Antigravity
 * installers all clone from GitHub — without git the install dies with a
 * confusing host-CLI error.
 */
async function ensureGit(): Promise<boolean> {
  refreshPathHints();
  if (await commandExists('git')) {
    log('  ✓ Git found');
    return true;
  }

  log('  Git not found — installing (required for plugin marketplace)…');
  let installed = false;

  if (IS_WINDOWS) {
    // Same as Node: winget's exit code is unreliable; trust PATH after refresh.
    if (await commandExists('winget')) {
      await run('winget', [
        'install',
        '--id',
        'Git.Git',
        '-e',
        '--silent',
        '--accept-package-agreements',
        '--accept-source-agreements',
      ]);
      refreshPathHints();
      installed = await commandExists('git');
    }
    if (!installed && (await commandExists('choco'))) {
      await run('choco', ['install', 'git', '-y']);
      refreshPathHints();
      installed = await commandExists('git');
    }
    if (!installed && (await commandExists('scoop'))) {
      await run('scoop', ['install', 'git']);
      refreshPathHints();
      installed = await commandExists('git');
    }
  } else if (process.platform === 'darwin' && (await commandExists('brew'))) {
    installed = (await run('brew', ['install', 'git'])) === 0;
  } else if (await commandExists('apt-get')) {
    const apt = (await commandExists('sudo'))
      ? 'sudo apt-get update -y && sudo apt-get install -y git'
      : 'apt-get update -y && apt-get install -y git';
    installed = (await runShell(apt)) === 0;
  } else if (await commandExists('dnf')) {
    const dnf = (await commandExists('sudo'))
      ? 'sudo dnf install -y git'
      : 'dnf install -y git';
    installed = (await runShell(dnf)) === 0;
  } else if (await commandExists('yum')) {
    const yum = (await commandExists('sudo'))
      ? 'sudo yum install -y git'
      : 'yum install -y git';
    installed = (await runShell(yum)) === 0;
  }

  refreshPathHints();
  if (await commandExists('git')) {
    log('  ✓ Git installed');
    return true;
  }

  log('  ✗ Could not install Git automatically.');
  log('    Install Git, then re-run `transcodes install`.');
  openUrl(
    IS_WINDOWS
      ? 'https://git-scm.com/download/win'
      : 'https://git-scm.com/downloads',
  );
  return false;
}

const HOST_CLIS: Record<PlatformId, HostCliSpec> = {
  claude: {
    binaries: ['claude'],
    label: 'Claude Code CLI (`claude`)',
    install: async () => {
      if (IS_WINDOWS) {
        return (
          (await run('npm', ['install', '-g', '@anthropic-ai/claude-code'])) ===
          0
        );
      }
      // Official native installer (recommended by Anthropic).
      const native =
        (await runShell('curl -fsSL https://claude.ai/install.sh | bash')) ===
        0;
      if (native) return true;
      return (
        (await run('npm', ['install', '-g', '@anthropic-ai/claude-code'])) === 0
      );
    },
  },
  codex: {
    binaries: ['codex'],
    label: 'Codex CLI (`codex`)',
    install: async () => {
      if (!IS_WINDOWS) {
        const native =
          (await runShell(
            'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
          )) === 0;
        if (native) return true;
      }
      return (await run('npm', ['install', '-g', '@openai/codex'])) === 0;
    },
  },
  cursor: {
    // Docs: `agent` is primary; `cursor-agent` is the backward-compatible name.
    binaries: ['cursor-agent', 'agent'],
    label: 'Cursor Agent CLI (`cursor-agent` / `agent`)',
    install: async () => {
      if (IS_WINDOWS) {
        return (
          (await runPowerShell(
            "irm 'https://cursor.com/install?win32=true' | iex",
          )) === 0
        );
      }
      return (
        (await runShell('curl https://cursor.com/install -fsS | bash')) === 0
      );
    },
  },
  antigravity: {
    binaries: ['agy'],
    label: 'Antigravity CLI (`agy`)',
    install: async () => {
      if (IS_WINDOWS) {
        // Vendor-documented Windows installer; drops agy.exe in %LOCALAPPDATA%\agy\bin.
        return (
          (await runPowerShell(
            'irm https://antigravity.google/cli/install.ps1 | iex',
          )) === 0
        );
      }
      return (
        (await runShell(
          'curl -fsSL https://antigravity.google/cli/install.sh | bash',
        )) === 0
      );
    },
  },
};

/** Ensure the host CLI is on PATH; install it via the vendor one-liner if not. */
async function ensureHostCli(id: PlatformId): Promise<boolean> {
  const spec = HOST_CLIS[id];
  refreshPathHints();
  const found = await anyCommandExists(spec.binaries);
  if (found) {
    log(`  ✓ ${spec.label} found (\`${found}\`)`);
    return true;
  }

  log(`  ${spec.label} not found — installing…`);
  const ok = await spec.install();
  refreshPathHints();
  const after = await anyCommandExists(spec.binaries);
  if (ok && after) {
    log(`  ✓ ${spec.label} installed (\`${after}\`)`);
    return true;
  }

  log(`  ✗ Failed to install ${spec.label}.`);
  log('    Install it manually, then re-run `transcodes install`.');
  return false;
}

/** One-shot line prompt: opens a readline, asks once, then closes it. */
function promptLine(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function dirHasMatch(dir: string, needles: readonly string[]): boolean {
  try {
    return fs
      .readdirSync(dir)
      .some((entry) => needles.some((n) => entry.includes(n)));
  } catch {
    return false;
  }
}

function fileHas(file: string, needle: string): boolean {
  try {
    return fs.readFileSync(file, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

/** Best-effort: is the transcodes-guard plugin already installed for this host? */
function isPluginInstalled(id: PlatformId): boolean {
  const home = os.homedir();
  switch (id) {
    case 'cursor':
      return safeExists(
        path.join(home, '.cursor', 'plugins', 'local', 'transcodes-guard'),
      );
    case 'antigravity':
      return safeExists(
        path.join(home, '.gemini', 'config', 'plugins', 'transcodes-guard'),
      );
    case 'claude':
      return (
        dirHasMatch(path.join(home, '.claude', 'plugins'), [
          'transcodes-guard',
          'bigstrider',
        ]) ||
        dirHasMatch(path.join(home, '.claude', 'plugins', 'marketplaces'), [
          'bigstrider',
          'transcodes-guard',
        ]) ||
        fileHas(
          path.join(home, '.claude', 'settings.json'),
          'transcodes-guard',
        ) ||
        fileHas(path.join(home, '.claude.json'), 'transcodes-guard')
      );
    case 'codex':
      return (
        dirHasMatch(path.join(home, '.codex', 'plugins'), [
          'transcodes-guard',
          'bigstrider',
        ]) ||
        fileHas(path.join(home, '.codex', 'config.toml'), 'transcodes-guard') ||
        fileHas(path.join(home, '.codex', 'config.json'), 'transcodes-guard')
      );
  }
}

type MenuChoice =
  | { kind: 'install'; ids: PlatformId[] }
  | { kind: 'skip' }
  | { kind: 'cancel' };

/** Short names for the "currently installed" summary line. */
function platformShortName(id: PlatformId): string {
  switch (id) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'ChatGPT';
    case 'cursor':
      return 'Cursor';
    case 'antigravity':
      return 'Antigravity';
  }
}

function installedAppsHint(): string {
  const names = PLATFORMS.filter((p) => isHostAppInstalled(p.id)).map((p) =>
    platformShortName(p.id),
  );
  if (names.length === 0) return t('platformInstalledNone');
  return t('platformInstalledApps', { list: names.join(', ') });
}

/** Numbered menu — host apps already on the device get [Detected]. */
function renderMenu(): void {
  log('');
  log(t('platformTitle'));
  log(t('platformHint1'));
  log(t('platformHint2'));
  log('');
  log(installedAppsHint());
  log('');
  PLATFORMS.forEach((p, i) => {
    const onDevice = isHostAppInstalled(p.id);
    const dot = onDevice ? '●' : '○';
    const mark = onDevice ? `   ${t('installed')}` : '';
    log(`  ${i + 1}. ${dot} ${p.label}${mark}`);
  });
  log(`  ${PLATFORMS.length + 1}. ${t('skipThisStep')}`);
  log('');
  log(t('platformNumberedHint'));
  log(t('platformNumberedNext', { n: String(PLATFORMS.length + 1) }));
}

async function promptMenu(): Promise<MenuChoice> {
  const nextNum = String(PLATFORMS.length + 1);
  for (;;) {
    const answer = (await promptLine('> ')).trim().toLowerCase();
    if (answer === 'exit' || answer === 'q') return { kind: 'cancel' };
    if (
      answer === '' ||
      answer === 's' ||
      answer === 'skip' ||
      answer === nextNum
    ) {
      return { kind: 'skip' };
    }
    if (answer === 'all' || answer === 'a') {
      return { kind: 'install', ids: PLATFORMS.map((p) => p.id) };
    }

    const tokens = answer.split(/[\s,]+/).filter(Boolean);
    const ids: PlatformId[] = [];
    let invalid = false;
    for (const token of tokens) {
      const num = Number(token);
      if (!Number.isInteger(num) || num < 1 || num > PLATFORMS.length) {
        log(
          `  Invalid choice "${token}". Use 1–${PLATFORMS.length}, ${nextNum} (Skip This Step), all, or exit.`,
        );
        invalid = true;
        break;
      }
      const pid = PLATFORMS[num - 1].id;
      if (!ids.includes(pid)) ids.push(pid);
    }
    if (invalid) continue;
    return { kind: 'install', ids };
  }
}

function supportsArrowSelect(): boolean {
  return isTty() && typeof process.stdin.setRawMode === 'function';
}

/**
 * Arrow-key checkbox selector. ↑/↓ move, space toggles, s skips the
 * platform step, q / Ctrl-C quits. Enter with 0 selected skips; Enter
 * with hosts selected installs them. The final action row reflects the same
 * result: install selected packages, or skip when none are selected.
 * Redraws in place via readline cursor control.
 */
function arrowSelect(checked: Set<PlatformId>): Promise<MenuChoice> {
  return new Promise((resolve) => {
    const rowCount = PLATFORMS.length + 1; // platforms + confirmation action
    let cursor = 0;
    let rendered = 0;
    const { stdin, stdout } = process;

    const draw = () => {
      const lines: string[] = [];
      lines.push(t('platformTitle'));
      lines.push(t('platformHint1'));
      lines.push(t('platformHint2'));
      lines.push('');
      lines.push(installedAppsHint());
      lines.push('');
      const labelWidth = Math.max(...PLATFORMS.map((p) => p.label.length));
      const detectedMark = t('installed');
      PLATFORMS.forEach((p, i) => {
        const pointer = cursor === i ? '❯' : ' ';
        const onDevice = isHostAppInstalled(p.id);
        const selected = checked.has(p.id);
        const box = selected ? '◉' : '◯';
        const mark = onDevice ? detectedMark : ' '.repeat(detectedMark.length);
        const action = selected ? t('selectedInstall') : t('selectedSkip');
        lines.push(
          `${pointer} ${box} ${p.label.padEnd(labelWidth)}  ${mark}  → ${action}`,
        );
      });
      const selectedCount = PLATFORMS.filter((p) => checked.has(p.id)).length;
      lines.push('');
      lines.push(
        selectedCount === 0
          ? t('platformSelectedNone')
          : t('platformSelectedCount', { n: String(selectedCount) }),
      );
      const nextPointer = cursor === PLATFORMS.length ? '❯' : ' ';
      lines.push('');
      lines.push(
        `${nextPointer}   ${
          selectedCount === 0 ? t('skipThisStep') : t('installSelected')
        }`,
      );
      lines.push('');
      lines.push(t('platformKeys'));
      rendered = redrawBlock(stdout, lines, rendered);
    };

    const cleanup = () => {
      stdout.write('\x1b[?25h'); // show cursor again
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (buf: Buffer) => {
      const key = buf.toString();
      if (key === '\u0003' || key === 'q') {
        cleanup();
        resolve({ kind: 'cancel' });
        return;
      }
      if (key === 's' || key === 'S') {
        cleanup();
        resolve({ kind: 'skip' });
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        const ids = PLATFORMS.filter((p) => checked.has(p.id)).map((p) => p.id);
        if (ids.length === 0) {
          resolve({ kind: 'skip' });
        } else {
          resolve({ kind: 'install', ids });
        }
        return;
      }
      if (key === ' ') {
        if (cursor < PLATFORMS.length) {
          const id = PLATFORMS[cursor].id;
          if (checked.has(id)) checked.delete(id);
          else checked.add(id);
        }
      } else if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + rowCount) % rowCount;
      } else if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % rowCount;
      } else {
        return;
      }
      draw();
    };

    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdout.write('\x1b[?25l'); // hide cursor while navigating
    draw();
  });
}

/**
 * Single-choice arrow menu (↑/↓ + Enter). Returns the chosen index, or -1 on
 * Ctrl-C. Same in-place, flicker-free redraw as {@link arrowSelect}.
 */
function arrowChoose(
  title: string,
  options: readonly string[],
  defaultIndex = 0,
): Promise<number> {
  return new Promise((resolve) => {
    let cursor = Math.max(0, Math.min(defaultIndex, options.length - 1));
    let rendered = 0;
    const { stdin, stdout } = process;

    const draw = () => {
      const lines: string[] = [title];
      options.forEach((opt, i) => {
        const pointer = cursor === i ? '❯' : ' ';
        const radio = cursor === i ? '◉' : '◯';
        lines.push(`${pointer} ${radio} ${opt}`);
      });
      lines.push('');
      lines.push(t('chooseKeys'));
      rendered = redrawBlock(stdout, lines, rendered);
    };

    const cleanup = () => {
      stdout.write('\x1b[?25h');
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (buf: Buffer) => {
      const key = buf.toString();
      if (key === '\u0003') {
        cleanup();
        resolve(-1);
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(cursor);
        return;
      }
      if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + options.length) % options.length;
      } else if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % options.length;
      } else {
        return;
      }
      draw();
    };

    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdout.write('\x1b[?25l');
    draw();
  });
}

/** Ensure host CLI + install plugin for each selected platform, then summarize. */
async function runInstalls(ids: readonly PlatformId[]): Promise<void> {
  const clonedRepoDir = await cloneRepoIfNeeded(ids);
  const results = new Map<PlatformId, boolean>();
  try {
    for (const id of ids) {
      const label = PLATFORMS.find((p) => p.id === id)?.label ?? id;
      log(`\n── ${label} ──`);
      results.set(id, await installPlatform(id, clonedRepoDir));
    }
  } finally {
    if (clonedRepoDir) {
      fs.rmSync(clonedRepoDir, { recursive: true, force: true });
    }
  }

  log(`\n${t('installSummary')}`);
  for (const id of ids) {
    const label = PLATFORMS.find((p) => p.id === id)?.label ?? id;
    log(`  ${results.get(id) ? '✓' : '✗'} ${label}`);
  }
}

/** Install one host plugin. Ensures host CLI first. */
async function installPlatform(
  id: PlatformId,
  clonedRepoDir: string | null,
): Promise<boolean> {
  if (!(await ensureHostCli(id))) return false;

  if (id === 'claude') {
    return runAll([
      { cmd: 'claude', args: ['plugin', 'marketplace', 'add', REPO_SLUG] },
      {
        cmd: 'claude',
        args: [
          'plugin',
          'install',
          `${PLUGIN_NAME}@${MARKETPLACE}`,
          '--scope',
          'user',
        ],
      },
    ]);
  }

  if (id === 'codex') {
    return runAll([
      { cmd: 'codex', args: ['plugin', 'marketplace', 'add', REPO_SLUG] },
      {
        cmd: 'codex',
        args: ['plugin', 'add', `${PLUGIN_NAME}@${MARKETPLACE}`],
      },
    ]);
  }

  // cursor / antigravity — run the committed installer from the repo clone.
  const platform = PLATFORMS.find((p) => p.id === id);
  if (!clonedRepoDir || !platform?.installerRel) {
    log(`  Skipped ${platform?.label ?? id} — repo clone unavailable.`);
    return false;
  }
  const installer = path.join(clonedRepoDir, platform.installerRel);
  if (!fs.existsSync(installer)) {
    log(`  Skipped ${platform.label} — installer missing at ${installer}.`);
    return false;
  }
  return (await run('node', [installer])) === 0;
}

/** Clone the repo to a temp dir when a filesystem-installer host is selected. */
async function cloneRepoIfNeeded(
  platforms: readonly PlatformId[],
): Promise<string | null> {
  const needsClone = platforms.some(
    (id) => PLATFORMS.find((p) => p.id === id)?.installerRel,
  );
  if (!needsClone) return null;

  if (!(await ensureGit())) {
    log('\n`git` is required to install Cursor / Antigravity plugins.');
    return null;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-install-'));
  const ok =
    (await run('git', ['clone', '--depth', '1', REPO_GIT_URL, tmpDir])) === 0;
  if (!ok) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    log('\nRepo clone failed — skipping Cursor / Antigravity.');
    return null;
  }
  return tmpDir;
}

function printSetupComplete(): void {
  clearScreen();
  log(t('congratsBar'));
  log(`  ${t('congrats1')}`);
  log(`  ${t('congrats2')}`);
  log(t('congratsBar'));
  log('');
  log(t('congratsBody'));
  log('');
}

/**
 * First screen of interactive install: English / 한국어.
 * Arrow (or numbered) picker; persists choice to ~/.transcodes/locale.
 */
async function promptLocale(): Promise<void> {
  if (!isTty()) {
    setLocale(readSavedLocale() ?? 'en');
    return;
  }

  const saved = readSavedLocale();
  const defaultIndex = saved === 'ko' ? 1 : 0;
  const options = ['English', '한국어'] as const;

  if (supportsArrowSelect()) {
    const idx = await arrowChoose(t('langTitle'), [...options], defaultIndex);
    if (idx < 0) {
      setLocale(saved ?? 'en');
      return;
    }
    setLocale(idx === 1 ? 'ko' : 'en');
    log('');
    return;
  }

  for (;;) {
    log(t('langTitle'));
    log('  1. English');
    log('  2. 한국어');
    const answer = (await promptLine('> ')).trim().toLowerCase();
    if (answer === '1' || answer === 'en' || answer === 'english') {
      setLocale('en');
      log('');
      return;
    }
    if (
      answer === '2' ||
      answer === 'ko' ||
      answer === 'kr' ||
      answer === '한국어'
    ) {
      setLocale('ko');
      log('');
      return;
    }
    if (answer === '' && saved) {
      setLocale(saved);
      log('');
      return;
    }
    log('  1 or 2 / 1 또는 2');
  }
}

/** Parse `install` args: platform ids and/or `--all`, else interactive. */
function parseSelection(args: string[]): PlatformId[] | 'interactive' {
  const ids: PlatformId[] = [];
  let explicit = false;
  for (const arg of args) {
    if (arg === '--all') {
      return PLATFORMS.map((p) => p.id);
    }
    const match = PLATFORMS.find(
      (p) => p.id === arg || (arg === 'chatgpt' && p.id === 'codex'),
    );
    if (match) {
      explicit = true;
      if (!ids.includes(match.id)) ids.push(match.id);
    }
  }
  return explicit ? ids : 'interactive';
}

export async function cmdInstall(args: string[]): Promise<void> {
  // Language first — before Node check / platform menu — so every following
  // prompt is already localized.
  await promptLocale();
  log(`${t('installBanner')}\n`);

  if (!(await ensureNode())) {
    process.exit(1);
  }
  if (!(await ensureGit())) {
    process.exit(1);
  }
  log('');

  const selection = parseSelection(args);

  if (selection === 'interactive') {
    if (!isTty()) {
      log(t('nonInteractive'));
      log('  transcodes install --all');
      log('  transcodes install claude codex cursor antigravity');
      process.exit(1);
    }
    // Select once, then install the selection or skip the platform step.
    // Arrow-key checkbox when the terminal supports raw mode, else numbered
    // fallback.
    const useArrows = supportsArrowSelect();
    // Pre-select host apps already on this machine (CLI and/or desktop app).
    const checked = new Set<PlatformId>(
      PLATFORMS.filter((p) => isHostAppInstalled(p.id)).map((p) => p.id),
    );
    for (;;) {
      // Always clear — CJK wrap + prior language screen leave garbage otherwise.
      clearScreen();
      let choice: MenuChoice;
      if (useArrows) {
        choice = await arrowSelect(checked);
      } else {
        renderMenu();
        choice = await promptMenu();
      }
      if (choice.kind === 'cancel') {
        log('');
        log(t('cancelHint'));
        process.exit(0);
      }
      if (choice.kind === 'skip') {
        clearScreen();
        log(t('platformSkipped'));
        log('');
        break;
      }
      await runInstalls(choice.ids);
      break;
    }
  } else {
    if (selection.length === 0) {
      log(t('noPlatforms'));
      process.exit(0);
    }
    log(
      `\n${t('installing', {
        list: selection
          .map((id) => PLATFORMS.find((p) => p.id === id)?.label ?? id)
          .join(', '),
      })}`,
    );
    await runInstalls(selection);
    clearScreen();
  }

  printSetupComplete();
  // Same as bare `transcodes` — background dashboard on 127.0.0.1.
  // Sign-in is done in the dashboard (or later via `transcodes login`).
  await ensureDashboard({});
  process.exit(0);
}

function installedPlatforms(): PlatformId[] {
  return PLATFORMS.filter((p) => isPluginInstalled(p.id)).map((p) => p.id);
}

/**
 * Update the published CLI via npm. The current process keeps running the
 * old binary until exit — that's expected; the next `transcodes` invocation
 * picks up the new version.
 *
 * Always target the install that is actually running (inferred prefix) and
 * the npm that belongs to this Node — not whatever `npm` happens to be first
 * on PATH (common Windows dual-Node failure mode).
 */
async function updateCliPackage(): Promise<boolean> {
  log(`\n── ${CLI_PACKAGE_NAME} (CLI) ──`);
  log(`  Current version: ${CLI_VERSION}`);
  refreshPathHints();

  const npm = resolveNpmInvocation();
  if (!npm) {
    log('  ✗ `npm` not found — cannot update the CLI.');
    log(
      `    Install Node.js / npm, then: npm install -g ${CLI_PACKAGE_NAME}@latest`,
    );
    return false;
  }

  let prefix = inferGlobalPrefixFromRunningCli();
  if (!prefix) {
    const pref = await runCapture(npm.cmd, [...npm.baseArgs, 'prefix', '-g']);
    if (pref.code === 0) {
      const trimmed = pref.stdout.trim();
      if (trimmed) prefix = trimmed;
    }
  }

  const npmLabel =
    npm.baseArgs.length > 0
      ? `${npm.cmd} ${path.basename(npm.baseArgs[0] ?? 'npm-cli.js')}`
      : npm.cmd;
  log(`  Using npm: ${npmLabel}`);
  if (prefix) log(`  Target prefix: ${prefix}`);

  const installArgs = [
    ...npm.baseArgs,
    'install',
    '-g',
    ...(prefix ? ['--prefix', prefix] : []),
    `${CLI_PACKAGE_NAME}@latest`,
  ];
  const ok = (await run(npm.cmd, installArgs)) === 0;
  if (!ok) {
    log('  ✗ CLI update failed.');
    return false;
  }

  // Prefer the prefix we just wrote so a stale shim earlier on PATH loses.
  // On Windows also ensure %APPDATA%\npm is registered — but never ahead of
  // a different prefix we intentionally updated.
  if (IS_WINDOWS && process.env.APPDATA) {
    const appDataNpm = path.join(process.env.APPDATA, 'npm');
    prependPathDir(appDataNpm);
    await persistUserPathWindows(appDataNpm);
  }
  if (prefix) {
    // Last prepend wins (front of PATH). On Unix the shim lives in `{prefix}/bin`.
    prependPathDir(prefix);
    if (!IS_WINDOWS) {
      const bin = path.join(prefix, 'bin');
      if (safeExists(bin)) prependPathDir(bin);
    }
    await persistUserPathWindows(prefix);
  }

  if (prefix) {
    const pkgJson = globalCliPackageJson(prefix);
    if (pkgJson) {
      try {
        const ver = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
          .version as unknown;
        if (typeof ver === 'string') {
          log(
            `  ✓ CLI updated to ${ver} (this process still reports ${CLI_VERSION} until exit).`,
          );
          log('    Run `transcodes version` in a new terminal to confirm.');
          return true;
        }
      } catch {
        // fall through
      }
    }
  }
  log('  ✓ CLI updated (run `transcodes version` to confirm).');
  return true;
}

/**
 * `transcodes update` — refresh installed host plugins in place, then bump
 * `@bigstrider/transcodes-cli` from npm.
 *
 * Flags:
 *   --cli-only       skip plugins
 *   --plugins-only   skip the npm CLI package
 *   <platforms>      only update those plugins (claude|codex|cursor|antigravity)
 *   --all            update every platform (even if not detected as installed)
 */
export async function cmdUpdate(args: string[]): Promise<void> {
  log('transcodes update — refresh plugins and CLI.\n');

  if (!(await ensureNode())) {
    process.exit(1);
  }
  if (!(await ensureGit())) {
    process.exit(1);
  }

  let cliOnly = false;
  let pluginsOnly = false;
  let forceAll = false;
  const platformArgs: string[] = [];
  for (const arg of args) {
    if (arg === '--cli-only') cliOnly = true;
    else if (arg === '--plugins-only') pluginsOnly = true;
    else if (arg === '--all') forceAll = true;
    else if (arg.startsWith('-')) {
      log(`Unknown flag "${arg}".`);
      log(
        'Usage: transcodes update [--cli-only|--plugins-only|--all] [claude|codex|cursor|antigravity …]',
      );
      process.exit(1);
    } else {
      platformArgs.push(arg);
    }
  }

  if (cliOnly && pluginsOnly) {
    log('Cannot combine --cli-only and --plugins-only.');
    process.exit(1);
  }

  const results: { name: string; ok: boolean }[] = [];

  if (!cliOnly) {
    let targets: PlatformId[];
    if (forceAll) {
      targets = PLATFORMS.map((p) => p.id);
    } else if (platformArgs.length > 0) {
      const parsed = parseSelection(platformArgs);
      if (parsed === 'interactive' || parsed.length === 0) {
        log(
          'No valid platforms. Use: claude, codex, cursor, antigravity (or chatgpt).',
        );
        process.exit(1);
      }
      targets = parsed;
    } else {
      targets = installedPlatforms();
    }

    if (targets.length === 0) {
      log('No installed plugins detected.');
      log('  Run `transcodes install` first, or `transcodes update --all`.');
    } else {
      log(
        `Updating plugins: ${targets
          .map((id) => PLATFORMS.find((p) => p.id === id)?.label ?? id)
          .join(', ')}`,
      );
      // Re-run the same install path (Cursor/Antigravity install.mjs and
      // Claude/Codex marketplace install are idempotent / in-place updates).
      const clonedRepoDir = await cloneRepoIfNeeded(targets);
      try {
        for (const id of targets) {
          const label = PLATFORMS.find((p) => p.id === id)?.label ?? id;
          log(`\n── ${label} ──`);
          const ok = await installPlatform(id, clonedRepoDir);
          results.push({ name: label, ok });
        }
      } finally {
        if (clonedRepoDir) {
          fs.rmSync(clonedRepoDir, { recursive: true, force: true });
        }
      }
    }
  }

  if (!pluginsOnly) {
    const ok = await updateCliPackage();
    results.push({ name: `${CLI_PACKAGE_NAME} (CLI)`, ok });
  }

  log('\n── Update summary ──');
  if (results.length === 0) {
    log('  (nothing to update)');
  } else {
    for (const r of results) {
      log(`  ${r.ok ? '✓' : '✗'} ${r.name}`);
    }
  }
  log('');
  log('Done. Restart your host apps/CLIs so they pick up the new plugin.');
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
