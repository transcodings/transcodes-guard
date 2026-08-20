/**
 * `transcodes uninstall` — reverse what `transcodes install` put on this
 * machine, so a tester can get back to a clean box in one command.
 *
 * Always removes host plugins, their hook / MCP / slash-command registrations,
 * and `~/.transcodes` (sign-in, dashboard state, Personas). The CLI itself
 * stays so `transcodes install` can run again immediately.
 *
 * The plan is always printed and confirmed before anything is touched, and
 * every removal is scoped to entries we wrote: host config files are pruned by
 * key/predicate, so hand-written hooks, MCP servers, and other plugins survive.
 *
 * Untouched: project-level `.transcodes/` folders and the rules/skills
 * `transcodes sync` or `persona deploy` generated inside repos — those are
 * indistinguishable from hand-written files.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { stopDashboard } from './dashboard-lifecycle.js';
import { readSavedLocale, t, useLocale } from './i18n.js';

const PLUGIN_NAME = 'transcodes-guard';
const MARKETPLACE = 'bigstrider';
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE}`;
const IS_WINDOWS = process.platform === 'win32';

/** Hook scripts the host plugins register, matched across all four hosts. */
const HOOK_SCRIPT =
  /\/dist\/hooks\/(pre-tool-use|pre-invocation|session-start|user-prompt-submit|before-submit-prompt|stop)\.js/;

export const UNINSTALL_USAGE = `Usage: transcodes uninstall [options]

  --dry-run          Print what would be removed, change nothing
  -y, --yes          Skip the confirmation prompt
`;

type HostId = 'claude' | 'codex' | 'cursor' | 'antigravity';

const HOST_LABELS: Record<HostId, string> = {
  claude: 'Claude',
  codex: 'ChatGPT (Codex)',
  cursor: 'Cursor',
  antigravity: 'Antigravity (Google)',
};

const HOST_IDS = Object.keys(HOST_LABELS) as HostId[];

type Options = {
  dryRun: boolean;
  yes: boolean;
};

/** One removal, with the line shown in the plan. */
type Step = { label: string; run: () => Promise<void> | void };

type Group = { title: string; steps: Step[] };

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string): never {
  process.stderr.write(`transcodes: ${message}\n`);
  process.exit(1);
}

function home(...parts: string[]): string {
  return path.join(os.homedir(), ...parts);
}

/** `~/…` form so plan lines stay readable and paste-safe. */
function tilde(p: string): string {
  const prefix = `${os.homedir()}${path.sep}`;
  return p.startsWith(prefix) ? `~${path.sep}${p.slice(prefix.length)}` : p;
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// --- host config pruning -----------------------------------------------------

/** Mutates `root` in place and returns how many entries it dropped. */
type Prune = (root: Record<string, unknown>) => number;

/** Runs `prune` against a copy so the plan can count without writing. */
function pruneCount(file: string, prune: Prune): number {
  const root = readJsonObject(file);
  return root ? prune(structuredClone(root)) : 0;
}

function pruneApply(file: string, prune: Prune): void {
  const root = readJsonObject(file);
  if (!root) return;
  if (prune(root) === 0) return;
  fs.writeFileSync(file, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
}

function isOurHook(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const raw = entry.command;
  if (typeof raw !== 'string') return false;
  const cmd = raw.split('\\').join('/');
  return cmd.includes(`/${PLUGIN_NAME}/`) || HOOK_SCRIPT.test(cmd);
}

/**
 * Drops our hook entries from a `hooks.json` / `settings.json`, handling both
 * shapes in use: flat (`hooks[event] = [{ command }]`, Cursor/Antigravity) and
 * matcher-grouped (`hooks[event] = [{ matcher, hooks: [{ command }] }]`,
 * Claude/Codex). Groups we emptied are dropped; groups that were already empty
 * are left alone.
 */
const stripHooks: Prune = (root) => {
  const hooks = root.hooks;
  if (!isRecord(hooks)) return 0;

  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const list = hooks[event];
    if (!Array.isArray(list)) continue;

    const kept: unknown[] = [];
    for (const entry of list) {
      if (isOurHook(entry)) {
        removed++;
        continue;
      }
      if (isRecord(entry) && Array.isArray(entry.hooks)) {
        const inner = entry.hooks;
        const innerKept = inner.filter((h) => !isOurHook(h));
        const innerRemoved = inner.length - innerKept.length;
        removed += innerRemoved;
        if (innerRemoved > 0 && innerKept.length === 0) continue;
        entry.hooks = innerKept;
      }
      kept.push(entry);
    }

    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  return removed;
};

/** Deletes keys of `root[container]` containing `needle`. */
function pruneKeys(container: string | null, needle: string): Prune {
  return (root) => {
    const target = container === null ? root : root[container];
    if (!isRecord(target)) return 0;
    let removed = 0;
    for (const key of Object.keys(target)) {
      if (!key.includes(needle)) continue;
      delete target[key];
      removed++;
    }
    return removed;
  };
}

const pruneMcpServer: Prune = pruneKeys('mcpServers', PLUGIN_NAME);

/** `~/.gemini/config/import_manifest.json` → `imports[]` rows we registered. */
const pruneGeminiImports: Prune = (root) => {
  const imports = root.imports;
  if (!Array.isArray(imports)) return 0;
  const kept = imports.filter(
    (entry) => !(isRecord(entry) && entry.name === PLUGIN_NAME),
  );
  const removed = imports.length - kept.length;
  if (removed > 0) root.imports = kept;
  return removed;
};

/**
 * Antigravity records per-tool approvals the user granted our plugin (its MCP
 * namespace, the `transcodes` binary, our config/plugin paths). They are dead
 * grants once the plugin is gone.
 */
const pruneGeminiGrants: Prune = (root) => {
  const settings = root.userSettings;
  if (!isRecord(settings)) return 0;
  const grants = settings.globalPermissionGrants;
  if (!isRecord(grants)) return 0;
  const allow = grants.allow;
  if (!Array.isArray(allow)) return 0;

  const kept = allow.filter(
    (entry) => !(typeof entry === 'string' && entry.includes('transcodes')),
  );
  const removed = allow.length - kept.length;
  if (removed > 0) grants.allow = kept;
  return removed;
};

// --- process helpers ---------------------------------------------------------

/**
 * `shell: true` on Windows hands the string to `cmd.exe` unescaped, so
 * anything with spaces or cmd metacharacters must be quoted by us.
 */
function quoteWinArg(arg: string): string {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

/** Runs a command without letting its chatter into our plan output. */
function runQuiet(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = IS_WINDOWS
      ? spawn(quoteWinArg(cmd), args.map(quoteWinArg), {
          stdio: 'ignore',
          env: process.env,
          shell: true,
        })
      : spawn(cmd, args, { stdio: 'ignore', env: process.env });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Walks PATH the way the shell would, so plan building stays synchronous. */
function hasBinary(cmd: string): boolean {
  const exts = IS_WINDOWS
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (exists(path.join(dir, `${cmd}${ext}`))) return true;
    }
  }
  return false;
}

// --- plan construction -------------------------------------------------------

function pathStep(target: string, note: string): Step | null {
  if (!exists(target)) return null;
  return {
    label: `${tilde(target)}  (${note})`,
    run: () => {
      fs.rmSync(target, { recursive: true, force: true });
    },
  };
}

/**
 * Collapses sibling directories a host generated for us (per-scope plugin data,
 * marketplace snapshots, per-project MCP logs) into a single plan line, so the
 * plan stays scannable no matter how many projects the user has opened.
 */
function matchStep(
  parent: string,
  matches: (name: string) => boolean,
  note: string,
): Step | null {
  let names: string[];
  try {
    names = fs.readdirSync(parent).filter(matches);
  } catch {
    return null;
  }
  if (names.length === 0) return null;

  const only = names[0] as string;
  const label =
    names.length === 1
      ? `${tilde(path.join(parent, only))}  (${note})`
      : `${tilde(parent)}${path.sep}*  (${names.length} ${note})`;
  return {
    label,
    run: () => {
      for (const name of names) {
        fs.rmSync(path.join(parent, name), { recursive: true, force: true });
      }
    },
  };
}

function jsonStep(file: string, note: string, prune: Prune): Step | null {
  const count = pruneCount(file, prune);
  if (count === 0) return null;
  return {
    label: `${tilde(file)}  (${count} ${note})`,
    run: () => pruneApply(file, prune),
  };
}

function cliStep(label: string, cmd: string, args: string[]): Step {
  return {
    label: `$ ${label}`,
    run: async () => {
      await runQuiet(cmd, args);
    },
  };
}

function planClaude(): Step[] {
  const plugins = home('.claude', 'plugins');
  const settings = home('.claude', 'settings.json');
  const registry = path.join(plugins, 'installed_plugins.json');

  const steps: Step[] = [];
  const registered =
    pruneCount(registry, pruneKeys('plugins', PLUGIN_NAME)) > 0;
  if (registered && hasBinary('claude')) {
    steps.push(
      cliStep(`claude plugin uninstall ${PLUGIN_ID}`, 'claude', [
        'plugin',
        'uninstall',
        PLUGIN_ID,
      ]),
      cliStep(`claude plugin marketplace remove ${MARKETPLACE}`, 'claude', [
        'plugin',
        'marketplace',
        'remove',
        MARKETPLACE,
      ]),
    );
  }

  return [
    ...steps,
    pathStep(path.join(plugins, 'marketplaces', MARKETPLACE), 'marketplace'),
    pathStep(path.join(plugins, 'cache', MARKETPLACE), 'plugin cache'),
    matchStep(
      path.join(plugins, 'data'),
      (name) => name.startsWith(PLUGIN_NAME),
      'plugin data dir',
    ),
    jsonStep(registry, 'plugin entry', pruneKeys('plugins', PLUGIN_NAME)),
    jsonStep(
      path.join(plugins, 'known_marketplaces.json'),
      'marketplace entry',
      pruneKeys(null, MARKETPLACE),
    ),
    jsonStep(settings, 'hook entry', stripHooks),
    jsonStep(
      settings,
      'enabled plugin entry',
      pruneKeys('enabledPlugins', PLUGIN_NAME),
    ),
  ].filter((step): step is Step => step !== null);
}

function planCodex(): Step[] {
  const config = home('.codex', 'config.toml');
  // Codex keeps plugin + marketplace state in TOML; its CLI is the only safe
  // editor for that file, so there is no filesystem fallback here.
  const registered = (() => {
    try {
      return fs.readFileSync(config, 'utf8').includes(PLUGIN_NAME);
    } catch {
      return false;
    }
  })();

  const steps: Step[] = [];
  if (registered && hasBinary('codex')) {
    steps.push(
      cliStep(`codex plugin remove ${PLUGIN_ID}`, 'codex', [
        'plugin',
        'remove',
        PLUGIN_ID,
      ]),
      cliStep(`codex plugin marketplace remove ${MARKETPLACE}`, 'codex', [
        'plugin',
        'marketplace',
        'remove',
        MARKETPLACE,
      ]),
    );
  }
  return [
    ...steps,
    pathStep(home('.codex', 'plugins', 'cache', MARKETPLACE), 'plugin cache'),
    matchStep(
      home('.codex', 'plugins', 'data'),
      (name) => name.startsWith(PLUGIN_NAME),
      'plugin data dir',
    ),
    pathStep(home('.codex', '.tmp', 'marketplaces', MARKETPLACE), 'snapshot'),
    jsonStep(home('.codex', 'hooks.json'), 'hook entry', stripHooks),
  ].filter((step): step is Step => step !== null);
}

/**
 * Cursor keeps a per-project MCP folder for every workspace the plugin ran in.
 * They are inert logs, but they are ours, and a tester wiping the box expects
 * them gone — collapsed into one step since there is one per project.
 */
function cursorProjectMcpStep(): Step | null {
  const projects = home('.cursor', 'projects');
  let targets: string[];
  try {
    targets = fs
      .readdirSync(projects)
      .flatMap((project) => {
        const mcps = path.join(projects, project, 'mcps');
        try {
          return fs
            .readdirSync(mcps)
            .filter((name) => name.includes(PLUGIN_NAME))
            .map((name) => path.join(mcps, name));
        } catch {
          return [];
        }
      })
      .sort();
  } catch {
    return null;
  }
  if (targets.length === 0) return null;

  return {
    label: `${tilde(projects)}${path.sep}*${path.sep}mcps${path.sep}*  (${targets.length} MCP state dir)`,
    run: () => {
      for (const target of targets) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    },
  };
}

function planCursor(): Step[] {
  const cursor = home('.cursor');
  return [
    pathStep(
      path.join(cursor, 'plugins', 'local', PLUGIN_NAME),
      'plugin bundle',
    ),
    pathStep(
      path.join(cursor, 'plugins', 'cache', MARKETPLACE),
      'plugin cache',
    ),
    pathStep(path.join(cursor, 'commands', 'transcodes.md'), 'slash command'),
    jsonStep(path.join(cursor, 'hooks.json'), 'hook entry', stripHooks),
    jsonStep(path.join(cursor, 'mcp.json'), 'MCP server', pruneMcpServer),
    cursorProjectMcpStep(),
  ].filter((step): step is Step => step !== null);
}

function planAntigravity(): Step[] {
  const config = home('.gemini', 'config');
  return [
    pathStep(path.join(config, 'plugins', PLUGIN_NAME), 'plugin bundle'),
    jsonStep(
      path.join(config, 'config.json'),
      'plugin registration',
      pruneKeys('plugins', PLUGIN_NAME),
    ),
    jsonStep(
      path.join(config, 'config.json'),
      'permission grant',
      pruneGeminiGrants,
    ),
    jsonStep(
      path.join(config, 'import_manifest.json'),
      'import entry',
      pruneGeminiImports,
    ),
    jsonStep(
      path.join(config, 'mcp_config.json'),
      'MCP server',
      pruneMcpServer,
    ),
    jsonStep(path.join(config, 'hooks.json'), 'hook entry', stripHooks),
    pathStep(
      home('.gemini', 'antigravity-cli', 'mcp', PLUGIN_NAME),
      'MCP state',
    ),
    pathStep(home('.gemini', 'antigravity', 'mcp', PLUGIN_NAME), 'MCP state'),
  ].filter((step): step is Step => step !== null);
}

function planHost(id: HostId): Step[] {
  switch (id) {
    case 'claude':
      return planClaude();
    case 'codex':
      return planCodex();
    case 'cursor':
      return planCursor();
    case 'antigravity':
      return planAntigravity();
  }
}

function planState(): Step[] {
  const step = pathStep(
    home('.transcodes'),
    'sign-in, settings, state, Personas',
  );
  return step ? [step] : [];
}

function buildPlan(): Group[] {
  const groups: Group[] = [];
  for (const id of HOST_IDS) {
    const steps = planHost(id);
    if (steps.length > 0) groups.push({ title: HOST_LABELS[id], steps });
  }
  const local = planState();
  if (local.length > 0) {
    groups.push({ title: t('uninstallGroupLocal'), steps: local });
  }
  return groups;
}

// --- command -----------------------------------------------------------------

function parseArgs(args: string[]): Options {
  let dryRun = false;
  let yes = false;

  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(UNINSTALL_USAGE);
      process.exit(0);
    } else {
      fail(`unknown flag "${arg}".\n\n${UNINSTALL_USAGE}`);
    }
  }

  return { dryRun, yes };
}

async function confirm(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(t('uninstallConfirm'), resolve);
    });
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

export async function cmdUninstall(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  useLocale(readSavedLocale() ?? 'en');

  log(t('uninstallBanner'));
  const groups = buildPlan();
  if (groups.length === 0) {
    log(`\n${t('uninstallNothing')}`);
    return;
  }

  log(`\n${t('uninstallPlanTitle')}`);
  for (const group of groups) {
    log(`  ${group.title}`);
    for (const step of group.steps) log(`    ${step.label}`);
  }
  log();
  log(t('uninstallKeepNote'));

  if (opts.dryRun) {
    log(`\n${t('uninstallDryRun')}`);
    return;
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      fail('non-interactive shell — re-run with --yes (or --dry-run).');
    }
    log();
    if (!(await confirm())) {
      log(t('uninstallAborted'));
      return;
    }
  }

  // The dashboard daemon holds ~/.transcodes/state open and would rewrite its
  // pid file after we delete it.
  try {
    await stopDashboard();
  } catch {
    // Not running, or already gone with its state file.
  }

  log();
  const failures: string[] = [];
  for (const group of groups) {
    log(`── ${group.title} ──`);
    for (const step of group.steps) {
      try {
        await step.run();
        log(`  ✓ ${step.label}`);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        log(`  ✗ ${step.label} — ${detail}`);
        failures.push(step.label);
      }
    }
  }

  log(`\n${t('uninstallDone')}`);
  if (failures.length > 0) {
    log(t('uninstallLeftovers'));
    for (const label of failures) log(`  ${label}`);
  }
  log(t('uninstallRestartNote'));
}
