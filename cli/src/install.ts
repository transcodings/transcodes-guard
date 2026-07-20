/**
 * `transcodes install` — one interactive flow that installs the host plugins,
 * saves a member token, then opens the dashboard.
 *
 * The published CLI package ships only `dist/` (no plugin bundles), so this
 * command orchestrates the SAME mechanisms the README documents:
 *   - Claude Code / Codex: their native host CLIs (`claude` / `codex`).
 *   - Cursor / Antigravity: a temp `git clone` + the committed `install.mjs`.
 *
 * Before each plugin install it ensures the host CLI is on PATH (installs it
 * if missing). Node.js LTS (>= 20) is checked first.
 *
 * Nothing here duplicates the gate; it only wires hosts and writes the token
 * via the shared `writeTokenToFile` (same source of truth as `transcodes set`).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface, moveCursor } from 'node:readline';
import {
  parseMemberAccessToken,
  transcodesConfigFile,
  writeTokenToFile,
} from '@transcodes-guard/core/stepup';
import { runDashboard } from './dashboard.js';
import { CLI_PACKAGE_NAME, CLI_VERSION } from './version.js';

const REPO_SLUG = 'transcodings/transcodes-guard';
const REPO_GIT_URL = 'https://github.com/transcodings/transcodes-guard.git';
const MARKETPLACE = 'bigstrider';
const PLUGIN_NAME = 'transcodes-guard';
const APP_CONSOLE_URL = 'https://app.transcodes.io';
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
  { id: 'claude', label: 'Claude Code' },
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

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** Clear the terminal so the next screen starts at the top. */
function clearScreen(): void {
  // CSI 2J = erase display, CSI H = cursor home. Works in most IDE TTYs.
  process.stdout.write('\x1b[2J\x1b[H');
}

function isTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Open a URL in the default browser (fire-and-forget). */
function openUrl(url: string): void {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(opener, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is printed alongside, so a failed launch is non-fatal.
  }
}

/**
 * Fresh installs often land under ~/.local/bin (or similar) which the current
 * process PATH may not include yet. Prepend common locations so the next
 * commandExists() check can see them without requiring a shell restart.
 */
function refreshPathHints(): void {
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

/** Resolve whether a command is on PATH. */
function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child =
      process.platform === 'win32'
        ? spawn('where', [cmd], { stdio: 'ignore' })
        : spawn('sh', ['-c', `command -v ${JSON.stringify(cmd)}`], {
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

/** Run a command with inherited stdio; resolves with the exit code. */
function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    log(`\n$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
    child.on('error', (err) => {
      log(`  (failed to start: ${err.message})`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Run a shell one-liner (vendor install scripts: curl | bash). */
function runShell(script: string): Promise<number> {
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
 * the official NodeSource+fnm path rather than failing silently — Cursor /
 * Antigravity installers and several host CLIs need it.
 */
async function ensureNode(): Promise<boolean> {
  log('── Prerequisites ──');
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

  if (process.platform === 'darwin' && (await commandExists('brew'))) {
    installed = (await run('brew', ['install', 'node'])) === 0;
  }

  if (!installed && (await commandExists('nvm'))) {
    installed = (await runShell('nvm install --lts && nvm use --lts')) === 0;
  }

  if (!installed) {
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

const HOST_CLIS: Record<PlatformId, HostCliSpec> = {
  claude: {
    binaries: ['claude'],
    label: 'Claude Code CLI (`claude`)',
    install: async () => {
      if (process.platform === 'win32') {
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
      if (process.platform !== 'win32') {
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
      if (process.platform === 'win32') {
        return (
          (await runShell(
            'powershell -NoProfile -Command "irm \'https://cursor.com/install?win32=true\' | iex"',
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
    install: async () =>
      (await runShell(
        'curl -fsSL https://antigravity.google/cli/install.sh | bash',
      )) === 0,
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
  | { kind: 'next' }
  | { kind: 'cancel' };

/** Numbered menu — reprints each round with live [Installed ✓] marks. */
function renderMenu(): void {
  log('');
  log('Please select platforms that you want to install:');
  log('Installing a plugin enables both its CLI and desktop app.');
  log('(Claude only supports the Claude Code tab)');
  log('');
  PLATFORMS.forEach((p, i) => {
    const mark = isPluginInstalled(p.id) ? '   [Installed ✓]' : '';
    log(`  ${i + 1}. ${p.label}${mark}`);
  });
  log(`  ${PLATFORMS.length + 1}. Next Step →`);
  log('');
  log('Enter numbers to install (e.g. 1,2), "all" or Enter to install all.');
  log(
    `Type ${
      PLATFORMS.length + 1
    } (or "next") for Next Step, "exit"/"q" to quit.`,
  );
}

async function promptMenu(): Promise<MenuChoice> {
  const nextNum = String(PLATFORMS.length + 1);
  for (;;) {
    const answer = (await promptLine('> ')).trim().toLowerCase();
    if (answer === 'exit' || answer === 'q') return { kind: 'cancel' };
    if (answer === 'next' || answer === 'n' || answer === nextNum) {
      return { kind: 'next' };
    }
    if (answer === '' || answer === 'all' || answer === 'a') {
      return { kind: 'install', ids: PLATFORMS.map((p) => p.id) };
    }

    const tokens = answer.split(/[\s,]+/).filter(Boolean);
    const ids: PlatformId[] = [];
    let invalid = false;
    for (const token of tokens) {
      const num = Number(token);
      if (!Number.isInteger(num) || num < 1 || num > PLATFORMS.length) {
        log(
          `  Invalid choice "${token}". Use 1–${PLATFORMS.length}, ${nextNum} (Next Step), all, or exit.`,
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
 * Arrow-key checkbox selector. ↑/↓ move, space toggles, `a` toggles all,
 * Enter confirms (installs checked, or proceeds when on "Next Step"),
 * q / Ctrl-C quits. Redraws in place via readline cursor control.
 *
 * Callers pass the initial `checked` set (defaults to empty / none selected).
 */
function arrowSelect(checked: Set<PlatformId>): Promise<MenuChoice> {
  return new Promise((resolve) => {
    const rowCount = PLATFORMS.length + 1; // platforms + "Next Step"
    let cursor = 0;
    let rendered = 0;
    const { stdin, stdout } = process;

    const draw = () => {
      const lines: string[] = [];
      lines.push('Please select platforms that you want to install:');
      lines.push('Installing a plugin enables both its CLI and desktop app.');
      lines.push('(Claude only supports the Claude Code tab)');
      lines.push('');
      PLATFORMS.forEach((p, i) => {
        const pointer = cursor === i ? '❯' : ' ';
        const box = checked.has(p.id) ? '◉' : '◯';
        const mark = isPluginInstalled(p.id) ? '   [Installed ✓]' : '';
        lines.push(`${pointer} ${box} ${p.label}${mark}`);
      });
      const nextPointer = cursor === PLATFORMS.length ? '❯' : ' ';
      lines.push(`${nextPointer}   Next Step →`);
      lines.push('');
      lines.push(
        '↑/↓ move · space select · a all/none · enter confirm · q quit/exit',
      );
      // Overwrite in place: move to the block top, then redraw each line with
      // "clear to end of line" (\x1b[K). Row count is constant, so we never
      // blank the whole region — that avoids the flash/flicker on each move.
      if (rendered > 0) moveCursor(stdout, 0, -rendered);
      const frame = lines.map((line) => `${line}\x1b[K`).join('\n');
      stdout.write(`${frame}\n`);
      rendered = lines.length;
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
      if (key === '\r' || key === '\n') {
        cleanup();
        if (cursor === PLATFORMS.length) {
          resolve({ kind: 'next' });
        } else {
          resolve({
            kind: 'install',
            ids: PLATFORMS.filter((p) => checked.has(p.id)).map((p) => p.id),
          });
        }
        return;
      }
      if (key === ' ') {
        if (cursor < PLATFORMS.length) {
          const id = PLATFORMS[cursor].id;
          if (checked.has(id)) checked.delete(id);
          else checked.add(id);
        }
      } else if (key === 'a') {
        if (PLATFORMS.every((p) => checked.has(p.id))) checked.clear();
        else for (const p of PLATFORMS) checked.add(p.id);
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
      lines.push('↑/↓ move · enter select');
      if (rendered > 0) moveCursor(stdout, 0, -rendered);
      stdout.write(`${lines.map((line) => `${line}\x1b[K`).join('\n')}\n`);
      rendered = lines.length;
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

type TokenAction = 'yes' | 'no' | 'skip';

/**
 * Three-way token prompt: Yes (paste a token), No (open console to get one),
 * or Skip (a token is already configured — go straight to the dashboard).
 * Arrow-selectable when the terminal supports it, else numbered fallback.
 */
async function chooseTokenAction(question: string): Promise<TokenAction> {
  const options = ['Yes', 'No', 'Skip — token already configured'];
  if (supportsArrowSelect()) {
    const idx = await arrowChoose(question, options, 0);
    return idx === 2 ? 'skip' : idx === 0 ? 'yes' : 'no';
  }
  for (;;) {
    log(question);
    for (let i = 0; i < options.length; i++) {
      log(`  ${i + 1}. ${options[i]}`);
    }
    const answer = (await promptLine('> ')).trim().toLowerCase();
    if (answer === '1' || answer === 'y' || answer === 'yes') return 'yes';
    if (answer === '2' || answer === 'n' || answer === 'no') return 'no';
    if (answer === '3' || answer === 'skip' || answer === 's') return 'skip';
    log('  Please choose 1, 2, or 3.');
  }
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

  log('\n── Install summary ──');
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

  if (!(await commandExists('git'))) {
    log('\n`git` not found on PATH — cannot install Cursor / Antigravity.');
    log('Install git and re-run, or use the one-liners from the README.');
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

/** Prompt for token + label and save. Returns true when saved. */
async function registerToken(): Promise<boolean> {
  log('');
  log('── Register MAT token ───────────────────────────────');
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = (await promptLine('Paste your token: ')).trim();
    if (!token) {
      log('  Token is required.');
      continue;
    }
    try {
      parseMemberAccessToken(token);
    } catch (err) {
      log(
        `  Token rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    let label = '';
    while (!label) {
      label = (
        await promptLine('Label (e.g. transcodes-myproject-prod): ')
      ).trim();
      if (!label) log('  Label is required.');
    }
    writeTokenToFile(token, label);
    log(`\nSaved token to ${transcodesConfigFile()} (label=${label}).`);
    log('');
    log(
      'Please restart your CLI or desktop app to activate transcodes plugins.',
    );
    return true;
  }
  log('\nToo many invalid attempts — run `transcodes install` again later.');
  return false;
}

function printSetupComplete(): void {
  clearScreen();
  log('────────────────────────────────────────────────────');
  log('  Congratulations!');
  log('  All setup is completed.');
  log('────────────────────────────────────────────────────');
  log('');
  log('Plugins are installed and your MAT token is saved.');
  log('');
}

/**
 * Token setup. Returns true when a token was saved (dashboard should open),
 * false when the user should exit (no token yet).
 */
async function tokenFlow(): Promise<boolean> {
  log('');
  log('── Token setup ──────────────────────────────────────');
  const choice = await chooseTokenAction(
    'Do you have a Transcodes project MAT (Member Access Token)?',
  );

  // Already configured elsewhere — nothing to save, but proceed to dashboard.
  if (choice === 'skip') {
    log('');
    log('Skipping token setup — using the token already configured.');
    return true;
  }

  if (choice === 'no') {
    log('');
    log(
      'You can create a MAT (Member Access Token) in the Transcodes console.',
    );
    log(
      "If you don't have access, ask your project administrator to issue one for you.",
    );
    log('');
    await promptLine(`Press ENTER to open the console (${APP_CONSOLE_URL}) … `);

    log(`\nOpening ${APP_CONSOLE_URL} …`);
    openUrl(APP_CONSOLE_URL);
    log('');
    log('  1) After sign-in, create a new project on the dashboard.');
    log('  2) Open the "Members & Tokens" tab and add a new member.');
    log(
      '  3) Generate a new token for that member, or ask your manager to get a token.',
    );
    log('  4) Paste it here.');
  }

  return registerToken();
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
  log('transcodes install — set up plugins, token, and dashboard.\n');

  if (!(await ensureNode())) {
    process.exit(1);
  }
  log('');

  const selection = parseSelection(args);
  let openDashboard = false;

  if (selection === 'interactive') {
    if (!isTty()) {
      log(
        'Non-interactive shell detected. Specify platforms explicitly, e.g.:',
      );
      log('  transcodes install --all');
      log('  transcodes install claude codex cursor antigravity');
      process.exit(1);
    }
    // Select → install → clear → same menu (with live Installed marks),
    // repeating until the user picks Next Step. Arrow-key checkbox when the
    // terminal supports raw mode, else a numbered-input fallback.
    const useArrows = supportsArrowSelect();
    const checked = new Set<PlatformId>();
    let firstMenu = true;
    for (;;) {
      if (!firstMenu) clearScreen();
      firstMenu = false;
      let choice: MenuChoice;
      if (useArrows) {
        choice = await arrowSelect(checked);
      } else {
        renderMenu();
        choice = await promptMenu();
      }
      if (choice.kind === 'cancel') {
        log('');
        log(
          'If you want to manage tokens directly, please type `transcodes` to open the dashboard',
        );
        process.exit(0);
      }
      if (choice.kind === 'next') {
        clearScreen();
        break;
      }
      if (choice.ids.length === 0) {
        log('  Nothing selected.');
        continue;
      }
      // Remember the selection so the next round re-checks the same boxes.
      checked.clear();
      for (const id of choice.ids) checked.add(id);
      await runInstalls(choice.ids);
    }
  } else {
    if (selection.length === 0) {
      log('No platforms selected — nothing to install.');
      process.exit(0);
    }
    log(
      `\nInstalling: ${selection
        .map((id) => PLATFORMS.find((p) => p.id === id)?.label ?? id)
        .join(', ')}`,
    );
    await runInstalls(selection);
    clearScreen();
  }

  openDashboard = await tokenFlow();

  if (!openDashboard) {
    process.exit(0);
  }

  printSetupComplete();
  await promptLine('Press ENTER to open the transcodes CLI dashboard … ');
  // Same as bare `transcodes` — local dashboard on 127.0.0.1.
  await runDashboard({});
  process.exit(0);
}

function installedPlatforms(): PlatformId[] {
  return PLATFORMS.filter((p) => isPluginInstalled(p.id)).map((p) => p.id);
}

/**
 * Update the published CLI via npm. The current process keeps running the
 * old binary until exit — that's expected; the next `transcodes` invocation
 * picks up the new version.
 */
async function updateCliPackage(): Promise<boolean> {
  log(`\n── ${CLI_PACKAGE_NAME} (CLI) ──`);
  log(`  Current version: ${CLI_VERSION}`);
  if (!(await commandExists('npm'))) {
    log('  ✗ `npm` not found on PATH — cannot update the CLI.');
    log(
      `    Install Node.js / npm, then: npm install -g ${CLI_PACKAGE_NAME}@latest`,
    );
    return false;
  }
  const ok =
    (await run('npm', ['install', '-g', `${CLI_PACKAGE_NAME}@latest`])) === 0;
  if (ok) {
    log('  ✓ CLI updated (run `transcodes version` to confirm).');
  } else {
    log('  ✗ CLI update failed.');
  }
  return ok;
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
