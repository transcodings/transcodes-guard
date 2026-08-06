/**
 * Persona — dashboard editor for the `.transcodes/` source of truth.
 *
 * The source of truth always lives in `~/.transcodes/`. The folder selected in
 * the dashboard is only the deployment output root. Deploy reads the central
 * source and writes each installed app's project files into the selected root.
 */

import { execFile, spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { dataDir, transcodesDir } from '@transcodes-guard/core/paths';
import { SKILL_FILE_NAME } from '../sync/constants/general.js';
import {
  RULESYNC_AGENTS_RELATIVE_DIR_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from '../sync/constants/rulesync-paths.js';
import { createFeatureScaffold } from '../sync/lib/feature-scaffold.js';

const execFileAsync = promisify(execFile);

export type PersonaKind = 'agent' | 'rule' | 'skill';

export type PersonaEntry = {
  name: string;
  /** Path relative to the project root, e.g. `.transcodes/rules/backend.md`. */
  relativePath: string;
};

export type PersonaListing = {
  /** Project folder where generated app files are deployed. */
  root: string;
  /** Fixed central source-of-truth folder (`~/.transcodes`). */
  sotDir: string;
  /** Currently selected Persona. */
  persona: string;
  /** All available Personas. */
  personas: string[];
  /** Absolute folder containing the selected Persona bundle. */
  personaDir: string;
  initialized: boolean;
  agent: { exists: boolean; relativePath: string };
  rules: PersonaEntry[];
  skills: PersonaEntry[];
};

export type PersonaFile = {
  kind: PersonaKind;
  name: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  content: string;
};

export type PersonaDeployResult = {
  ok: boolean;
  exitCode: number;
  output: string;
};

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const LAST_ROOT_FILE = 'dashboard-persona.json';
const PERSONAS_DIR_NAME = 'personas';
const PERSONA_INSTRUCTION_DIR_NAME = 'instruction';

/**
 * Default Agent root: user home on macOS / Linux / Windows.
 * Claude (`~/.claude`), Cursor (`~/.cursor`), and Antigravity (`~/.gemini`)
 * all store their user config under this directory.
 */
export function defaultPersonaRoot(): string {
  return path.resolve(os.homedir());
}

export function defaultPersonaSotDir(): string {
  return path.resolve(transcodesDir());
}

/**
 * Resolve the user-picked deployment folder. The source of truth is always
 * `~/.transcodes` and never moves with the deployment target.
 */
export async function resolvePersonaRoot(input?: string): Promise<{
  root: string;
  sotDir: string;
}> {
  const raw = (input ?? (await readLastRoot()) ?? defaultPersonaRoot()).trim();
  const expanded = raw.replace(/^~(?=$|\/|\\)/, os.homedir());
  const resolved = path.resolve(expanded);

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(resolved);
  } catch {
    return {
      root: resolved,
      sotDir: defaultPersonaSotDir(),
    };
  }

  if (!stats.isDirectory()) {
    throw new Error(`Not a folder: ${resolved}`);
  }

  return {
    root: resolved,
    sotDir: defaultPersonaSotDir(),
  };
}

/** Reject names that could escape `.transcodes/` or collide with dotfiles. */
export function assertPersonaName(kind: PersonaKind, name: string): string {
  if (kind === 'agent') return RULESYNC_OVERVIEW_FILE_NAME;
  const normalized = name.trim().replace(/\.md$/i, '');
  if (!NAME_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid ${kind} name "${name}". Use letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  return normalized;
}

export function assertPersonaId(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '-');
  if (!NAME_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid Persona name "${name}". Use letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  return normalized;
}

function personasRoot(): string {
  return path.join(defaultPersonaSotDir(), PERSONAS_DIR_NAME);
}

function personaDir(persona: string): string {
  return path.join(personasRoot(), assertPersonaId(persona));
}

function personaBundleRelativePath(kind: PersonaKind, name: string): string {
  if (kind === 'agent') {
    return path.posix.join(
      PERSONA_INSTRUCTION_DIR_NAME,
      RULESYNC_OVERVIEW_FILE_NAME,
    );
  }
  if (kind === 'rule') {
    return path.posix.join('rules', `${name}.md`);
  }
  return path.posix.join('skills', name, SKILL_FILE_NAME);
}

export function personaRelativePath(
  persona: string,
  kind: PersonaKind,
  name: string,
): string {
  return path.posix.join(
    RULESYNC_RELATIVE_DIR_PATH,
    PERSONAS_DIR_NAME,
    assertPersonaId(persona),
    personaBundleRelativePath(kind, name),
  );
}

function resolveInsidePersona(persona: string, relativePath: string): string {
  const bundleRoot = personaDir(persona);
  const target = path.resolve(bundleRoot, relativePath);
  const rel = path.relative(bundleRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Refusing to touch a path outside Persona "${persona}": ${target}`,
    );
  }
  return target;
}

async function listPersonaIds(): Promise<string[]> {
  const names = await readdirSafe(personasRoot());
  const personas: string[] = [];
  for (const name of names.sort()) {
    if (
      !NAME_PATTERN.test(name) ||
      !(await isDirectory(path.join(personasRoot(), name)))
    ) {
      continue;
    }
    personas.push(name);
  }
  return personas;
}

async function copyIfExists(source: string, target: string): Promise<void> {
  try {
    await stat(source);
  } catch {
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
}

async function stagePersonaInstruction(
  source: string,
  target: string,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(source, 'utf-8');
  } catch {
    return;
  }

  const body = sanitizePersonaContent('agent', content).replace(/\s+$/, '');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${body}\n`, 'utf-8');
}

async function stagePersonaSkills(
  source: string,
  target: string,
): Promise<void> {
  await copyIfExists(source, target);
  for (const name of await readdirSafe(target)) {
    const skillPath = path.join(target, name, SKILL_FILE_NAME);
    if (!(await isFile(skillPath))) continue;
    const content = await readFile(skillPath, 'utf-8');
    const sanitized = sanitizePersonaContent('skill', content);
    const synchronized = synchronizeSkillName(sanitized, name);
    await writeFile(
      skillPath,
      `${synchronized.replace(/\s+$/, '')}\n`,
      'utf-8',
    );
  }
}

async function ensurePersonaStorage(): Promise<void> {
  await mkdir(personasRoot(), { recursive: true });
}

export async function createPersona(name: string): Promise<string> {
  await ensurePersonaStorage();
  const persona = assertPersonaId(name);
  const bundleDir = personaDir(persona);
  try {
    await mkdir(bundleDir, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Persona "${persona}" already exists.`);
    }
    throw error;
  }

  try {
    const instructionPath = path.join(
      bundleDir,
      PERSONA_INSTRUCTION_DIR_NAME,
      RULESYNC_OVERVIEW_FILE_NAME,
    );
    const instruction = `${starterTemplate('agent', '').replace(/\s+$/, '')}\n`;
    await mkdir(path.dirname(instructionPath), { recursive: true });
    await writeFile(instructionPath, instruction, 'utf-8');
  } catch (error) {
    await rm(bundleDir, { recursive: true, force: true });
    throw error;
  }

  return persona;
}

export async function deletePersona(name: string): Promise<string> {
  await ensurePersonaStorage();
  const persona = assertPersonaId(name);
  const personas = await listPersonaIds();
  if (!personas.includes(persona)) {
    throw new Error(`Persona "${persona}" does not exist.`);
  }
  await rm(personaDir(persona), { recursive: true, force: false });
  return persona;
}

export async function listPersona(
  rootInput?: string,
  personaInput?: string,
): Promise<PersonaListing> {
  const { root, sotDir } = await resolvePersonaRoot(rootInput);
  await ensurePersonaStorage();
  await writeLastRoot(root);

  const personas = await listPersonaIds();
  const requestedPersona = personaInput?.trim()
    ? assertPersonaId(personaInput)
    : undefined;
  if (personas.length === 0) {
    return {
      root,
      sotDir,
      persona: '',
      personas: [],
      personaDir: '',
      initialized: false,
      agent: { exists: false, relativePath: '' },
      rules: [],
      skills: [],
    };
  }
  const persona =
    requestedPersona && personas.includes(requestedPersona)
      ? requestedPersona
      : personas[0]!;
  const bundleRoot = personaDir(persona);
  const agentRelative = personaRelativePath(persona, 'agent', '');
  const [agentExists, rules, skills] = await Promise.all([
    isFile(
      path.join(
        bundleRoot,
        PERSONA_INSTRUCTION_DIR_NAME,
        RULESYNC_OVERVIEW_FILE_NAME,
      ),
    ),
    listRules(persona, bundleRoot),
    listSkills(persona, bundleRoot),
  ]);

  return {
    root,
    sotDir,
    persona,
    personas,
    personaDir: bundleRoot,
    initialized: agentExists || rules.length > 0 || skills.length > 0,
    agent: { exists: agentExists, relativePath: agentRelative },
    rules,
    skills,
  };
}

async function listRules(
  persona: string,
  bundleRoot: string,
): Promise<PersonaEntry[]> {
  const dir = path.join(bundleRoot, 'rules');
  const names = await readdirSafe(dir);
  return names
    .filter((n) => n.endsWith('.md') && !n.startsWith('.'))
    .map((n) => n.replace(/\.md$/i, ''))
    .sort()
    .map((name) => ({
      name,
      relativePath: personaRelativePath(persona, 'rule', name),
    }));
}

async function listSkills(
  persona: string,
  bundleRoot: string,
): Promise<PersonaEntry[]> {
  const dir = path.join(bundleRoot, 'skills');
  const names = await readdirSafe(dir);
  const entries: PersonaEntry[] = [];
  for (const name of names.sort()) {
    if (name.startsWith('.')) continue;
    if (!(await isFile(path.join(dir, name, SKILL_FILE_NAME)))) continue;
    entries.push({
      name,
      relativePath: personaRelativePath(persona, 'skill', name),
    });
  }
  return entries;
}

export async function readPersonaFile(params: {
  root?: string;
  persona: string;
  kind: PersonaKind;
  name?: string;
}): Promise<PersonaFile> {
  await resolvePersonaRoot(params.root);
  await ensurePersonaStorage();
  const persona = assertPersonaId(params.persona);
  const name = assertPersonaName(params.kind, params.name ?? '');
  const relativePath = personaRelativePath(persona, params.kind, name);
  const absolutePath = resolveInsidePersona(
    persona,
    personaBundleRelativePath(params.kind, name),
  );

  try {
    const content = await readFile(absolutePath, 'utf-8');
    return {
      kind: params.kind,
      name,
      relativePath,
      absolutePath,
      exists: true,
      content: sanitizePersonaContent(params.kind, content),
    };
  } catch {
    return {
      kind: params.kind,
      name,
      relativePath,
      absolutePath,
      exists: false,
      content: starterTemplate(params.kind, name),
    };
  }
}

/** Keep Rulesync-only metadata out of user-facing Persona instructions. */
function stripLeadingFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^(?:\r?\n)+/, '');
}

/** Remove deprecated per-file `targets:` from YAML frontmatter (Apply -t is SSOT). */
function stripLegacyTargetsFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  const fm = content.slice(0, end + 4);
  const body = content.slice(end + 4);
  const cleaned = fm
    .split('\n')
    .filter((line) => !/^\s*targets\s*:/.test(line))
    .join('\n');
  return cleaned === fm ? content : cleaned + body;
}

function sanitizePersonaContent(kind: PersonaKind, content: string): string {
  return kind === 'agent'
    ? stripLeadingFrontmatter(content)
    : stripLegacyTargetsFrontmatter(content);
}

/** Keep the Skill folder name and required frontmatter identity in sync. */
function synchronizeSkillName(content: string, name: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;

  const frontmatter = content.slice(0, end + 4);
  const body = content.slice(end + 4);
  const nameLine = /^name\s*:.*$/m;
  const synchronized = nameLine.test(frontmatter)
    ? frontmatter.replace(nameLine, `name: ${name}`)
    : frontmatter.replace(/^---(?:\r?\n)?/, `---\nname: ${name}\n`);
  return synchronized + body;
}

function starterTemplate(kind: PersonaKind, name: string): string {
  const scaffold = createFeatureScaffold({
    feature: kind === 'skill' ? 'skill' : 'rule',
    name: kind === 'agent' ? 'agents' : name,
  });
  return sanitizePersonaContent(kind, scaffold.content);
}

export async function savePersonaFile(params: {
  root?: string;
  persona: string;
  kind: PersonaKind;
  name?: string;
  content: string;
}): Promise<PersonaFile> {
  const { root } = await resolvePersonaRoot(params.root);
  await ensurePersonaStorage();
  const persona = assertPersonaId(params.persona);
  if (!(await isDirectory(personaDir(persona)))) {
    throw new Error(`Persona "${persona}" does not exist.`);
  }
  const name = assertPersonaName(params.kind, params.name ?? '');
  const relativePath = personaRelativePath(persona, params.kind, name);
  const absolutePath = resolveInsidePersona(
    persona,
    personaBundleRelativePath(params.kind, name),
  );

  const sanitized = sanitizePersonaContent(params.kind, params.content);
  const synchronized =
    params.kind === 'skill' ? synchronizeSkillName(sanitized, name) : sanitized;
  const content = `${synchronized.replace(/\s+$/, '')}\n`;
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf-8');
  await writeLastRoot(root);

  return {
    kind: params.kind,
    name,
    relativePath,
    absolutePath,
    exists: true,
    content,
  };
}

/**
 * Remove a persona entry from `.transcodes/`.
 * Skills delete the whole `<name>/` folder; rules/agents delete the `.md` file.
 */
export async function deletePersonaFile(params: {
  root?: string;
  persona: string;
  kind: PersonaKind;
  name?: string;
}): Promise<{ kind: PersonaKind; name: string; relativePath: string }> {
  const { root } = await resolvePersonaRoot(params.root);
  await ensurePersonaStorage();
  const persona = assertPersonaId(params.persona);
  const name = assertPersonaName(params.kind, params.name ?? '');
  const relativePath = personaRelativePath(persona, params.kind, name);
  const absolutePath = resolveInsidePersona(
    persona,
    personaBundleRelativePath(params.kind, name),
  );

  // Skills are a folder of assets — remove the directory, not only SKILL.md.
  const target =
    params.kind === 'skill' ? path.dirname(absolutePath) : absolutePath;

  // Re-check the final removal target because skills remove their whole folder.
  resolveInsidePersona(
    persona,
    path.relative(personaDir(persona), target).split(path.sep).join('/'),
  );

  try {
    await rm(target, { recursive: true, force: true });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : `Could not remove ${relativePath}`,
    );
  }

  await writeLastRoot(root);
  return { kind: params.kind, name, relativePath };
}

export async function deployPersona(params?: {
  root?: string;
  persona?: string;
  targets?: string[];
  /** When true, pass `--global` so hosts write user-scope paths (e.g. ~/.claude). */
  global?: boolean;
}): Promise<PersonaDeployResult> {
  const { root } = await resolvePersonaRoot(params?.root);
  const listing = await listPersona(root, params?.persona);
  const persona = listing.persona;
  if (!listing.initialized) {
    return {
      ok: false,
      exitCode: 1,
      output: `Nothing to deploy in Persona "${persona}". Add an Instruction, Rule, or Skill first.`,
    };
  }
  const stagingRoot = await mkdtemp(
    path.join(os.tmpdir(), 'transcodes-persona-'),
  );
  const stagingSot = path.join(stagingRoot, RULESYNC_RELATIVE_DIR_PATH);
  await mkdir(stagingSot, { recursive: true });
  await Promise.all([
    stagePersonaInstruction(
      path.join(
        listing.personaDir,
        PERSONA_INSTRUCTION_DIR_NAME,
        RULESYNC_OVERVIEW_FILE_NAME,
      ),
      path.join(
        stagingRoot,
        RULESYNC_AGENTS_RELATIVE_DIR_PATH,
        RULESYNC_OVERVIEW_FILE_NAME,
      ),
    ),
    copyIfExists(
      path.join(listing.personaDir, 'rules'),
      path.join(stagingRoot, RULESYNC_RULES_RELATIVE_DIR_PATH),
    ),
    stagePersonaSkills(
      path.join(listing.personaDir, 'skills'),
      path.join(stagingRoot, RULESYNC_SKILLS_RELATIVE_DIR_PATH),
    ),
  ]);
  const args = [
    'sync',
    'generate',
    '--input-root',
    stagingRoot,
    '--output-roots',
    root,
    '--delete',
  ];
  if (params?.global) {
    args.push('--global');
  }
  if (params?.targets && params.targets.length > 0) {
    args.push('-t', params.targets.join(','));
  }

  const runGenerate = (runArgs: string[]): Promise<PersonaDeployResult> =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [cliEntryPath(), ...runArgs], {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on('error', (err) => {
        resolve({ ok: false, exitCode: 1, output: `${output}${err.message}` });
      });
      child.on('close', (code) => {
        const exitCode = code ?? 1;
        resolve({ ok: exitCode === 0, exitCode, output: output.trim() });
      });
    });

  try {
    // Validate and render everything before touching the destination. Without
    // this preflight, one invalid Rule could leave earlier Skill outputs behind.
    const preflight = await runGenerate([...args, '--dry-run']);
    if (!preflight.ok) return preflight;
    return await runGenerate(args);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function cliEntryPath(): string {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error('Could not resolve the transcodes CLI entry point.');
  }
  return entry;
}

/** Open the selected deployment directory in the system file manager. */
export async function revealPersonaFolder(rootInput?: string): Promise<string> {
  const { root } = await resolvePersonaRoot(rootInput);
  const rootStats = await stat(root).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error(`Directory does not exist: ${root}`);
  }

  if (process.platform === 'darwin') {
    await execFileAsync('open', [root]);
  } else if (process.platform === 'win32') {
    try {
      // Prefer explorer.exe; bare `explorer` can resolve oddly under some shells.
      await execFileAsync('explorer.exe', [root]);
    } catch (error: unknown) {
      // Explorer often exits with code 1 after successfully opening a folder.
      // Treat that as success; surface real launch failures (e.g. ENOENT).
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code !== 1) throw error;
    }
  } else {
    await execFileAsync('xdg-open', [root]);
  }
  return root;
}

/**
 * Native folder picker. Opens at `startPath` when provided.
 * Returns null when the user cancels.
 * macOS: osascript · Windows: PowerShell FolderBrowserDialog · Linux: zenity
 */
export async function pickProjectFolder(
  startPath?: string,
): Promise<string | null> {
  const start = await resolveExistingDir(startPath);
  if (process.platform === 'darwin') return pickWithOsascript(start);
  if (process.platform === 'win32') return pickWithPowerShell(start);
  return pickWithZenity(start);
}

async function resolveExistingDir(
  startPath?: string,
): Promise<string | undefined> {
  if (!startPath?.trim()) return undefined;
  const resolved = path.resolve(
    startPath.trim().replace(/^~(?=$|\/|\\)/, os.homedir()),
  );
  try {
    if ((await stat(resolved)).isDirectory()) return resolved;
  } catch {
    // fall through
  }
  return undefined;
}

async function pickWithOsascript(startPath?: string): Promise<string | null> {
  const prompt =
    'Select the project folder where this Persona will be deployed';
  const lines = [
    'tell application "System Events" to activate',
    startPath
      ? `POSIX path of (choose folder with prompt ${JSON.stringify(
          prompt,
        )} default location POSIX file ${JSON.stringify(startPath)})`
      : `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`,
  ];
  try {
    const { stdout } = await execFileAsync('osascript', [
      ...lines.flatMap((line) => ['-e', line]),
    ]);
    const picked = stdout.trim();
    return picked.length > 0 ? picked.replace(/\/$/, '') : null;
  } catch (err) {
    if (isUserCancelled(err)) return null;
    throw new Error('Could not open the folder picker — type a path instead.');
  }
}

/**
 * PowerShell single-quoted string literal. Paths with apostrophes (and any
 * Unicode folder name) must not go through console stdout — WinPS 5.1 emits
 * the system ANSI/OEM code page there, so Node's UTF-8 decode turns Korean /
 * Japanese / Chinese paths into replacement characters.
 */
function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function pickWithPowerShell(startPath?: string): Promise<string | null> {
  // Write the picked path to a UTF-8 file instead of stdout. Console capture
  // on Korean/Japanese Windows corrupts non-ASCII paths (� / mojibake).
  const outFile = path.join(
    os.tmpdir(),
    `transcodes-folder-${process.pid}-${Date.now()}.txt`,
  );
  const startLiteral = startPath
    ? `$d.SelectedPath = ${psSingleQuote(startPath)}; `
    : '';
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = "Select the Persona deployment project folder"',
    startLiteral,
    'if ($d.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }',
    `[System.IO.File]::WriteAllText(${psSingleQuote(outFile)}, $d.SelectedPath, (New-Object System.Text.UTF8Encoding $false))`,
  ].join('; ');
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);
    const picked = (await readFile(outFile, 'utf8').catch(() => '')).trim();
    return picked.length > 0 ? picked : null;
  } catch {
    throw new Error('Could not open the folder picker — type a path instead.');
  } finally {
    await rm(outFile, { force: true }).catch(() => {});
  }
}

async function pickWithZenity(startPath?: string): Promise<string | null> {
  const args = [
    '--file-selection',
    '--directory',
    '--title=Select the Persona deployment project folder',
  ];
  if (startPath) args.push(`--filename=${startPath}${path.sep}`);
  try {
    const { stdout } = await execFileAsync('zenity', args);
    const picked = stdout.trim();
    return picked.length > 0 ? picked : null;
  } catch (err) {
    if (isUserCancelled(err)) return null;
    throw new Error('Could not open the folder picker — type a path instead.');
  }
}

function isUserCancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /User canceled|cancell?ed|-128/i.test(message);
}

export async function readLastRoot(): Promise<string | null> {
  try {
    const raw = await readFile(lastRootFile(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { root?: unknown }).root === 'string'
    ) {
      return (parsed as { root: string }).root;
    }
  } catch {
    // none yet
  }
  return null;
}

export async function writeLastRoot(root: string): Promise<void> {
  try {
    await mkdir(path.dirname(lastRootFile()), { recursive: true });
    await writeFile(
      lastRootFile(),
      `${JSON.stringify({ root }, null, 2)}\n`,
      'utf-8',
    );
  } catch {
    // convenience only
  }
}

function lastRootFile(): string {
  return path.join(dataDir(), LAST_ROOT_FILE);
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
