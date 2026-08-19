import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  detectInstalledHostConfigTargets,
  getGlobalPersonaSyncTargets,
} from './host-apps.js';
import {
  assertPersonaId,
  createPersona,
  deletePersona,
  deletePersonaFile,
  deleteSkillPath,
  deployPersona,
  KNOWLEDGE_BASE_SKILL_NAME,
  listPersona,
  type PersonaKind,
  readPersonaFile,
  resolvePersonaRoot,
  savePersonaBatch,
  savePersonaFile,
} from './persona.js';
import {
  fetchPersonaRevisions,
  loadPersonaConfig,
  updatePersonaTag,
} from './persona-api.js';
import {
  clearPersonaSyncRevision,
  pullPersonaSync,
  pushPersonaSync,
} from './persona-sync.js';

const PERSONA_USAGE =
  'transcodes persona <list|create|read|save|delete|delete-file|delete-reference|deploy|push|pull|log|tag>';

const DEPLOY_TARGET_ALIASES = {
  claude: 'claudecode',
  claudecode: 'claudecode',
  cursor: 'cursor',
  chatgpt: 'codexcli',
  codex: 'codexcli',
  codexcli: 'codexcli',
  antigravity: 'antigravity-ide',
  'antigravity-ide': 'antigravity-ide',
} as const;

const ALL_DEPLOY_TARGETS = [
  'claudecode',
  'cursor',
  'codexcli',
  'antigravity-ide',
] as const;

const BOOLEAN_FLAGS = new Set([
  'global',
  'installed',
  'yes',
  'dry-run',
  'delete',
]);

type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string>;
  stdin: boolean;
};

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  let stdin = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--stdin') {
      stdin = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags.set(key, 'true');
        continue;
      }
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      flags.set(key, value);
      index += 1;
      continue;
    }
    positionals.push(arg);
  }

  return { positionals, flags, stdin };
}

function requiredFlag(parsed: ParsedArgs, name: string): string {
  const value = parsed.flags.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function optionalFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name)?.trim();
  return value || undefined;
}

function personaKind(parsed: ParsedArgs): PersonaKind {
  const kind = requiredFlag(parsed, 'kind');
  if (kind !== 'agent' && kind !== 'rule' && kind !== 'skill') {
    throw new Error('--kind must be agent, rule, or skill.');
  }
  return kind;
}

function skillFileFlag(
  parsed: ParsedArgs,
  kind: PersonaKind,
): string | undefined {
  const file = optionalFlag(parsed, 'file');
  if (file && kind !== 'skill') {
    throw new Error(
      '--file applies to --kind skill only (skill-root-relative path such as scripts/extract.py or references/billing-api.md).',
    );
  }
  return file;
}

const NO_GLOBAL_HOSTS_ERROR =
  'No installed .claude, .codex, or .gemini config root found under your home directory (Cursor is project-only; rulesync does not support Cursor --global rules).';

function deployTargets(
  parsed: ParsedArgs,
  fallback?: string[],
  options?: { global?: boolean },
): string[] {
  const global = options?.global === true;
  const raw = optionalFlag(parsed, 'targets');
  if (!raw) {
    if (fallback && fallback.length > 0) return [...fallback];
    throw new Error(
      '--targets is required. Use claude, cursor, chatgpt, antigravity, all, or --global.',
    );
  }
  if (raw.toLowerCase() === 'all') {
    return global
      ? [...getGlobalPersonaSyncTargets()]
      : [...ALL_DEPLOY_TARGETS];
  }
  if (raw.toLowerCase() === 'installed') {
    const detected = detectInstalledHostConfigTargets();
    if (detected.targets.length === 0) {
      throw new Error(NO_GLOBAL_HOSTS_ERROR);
    }
    return detected.targets;
  }

  const targets = raw
    .split(',')
    .map((target) => target.trim().toLowerCase())
    .filter(Boolean)
    .map((target) => {
      const resolved =
        DEPLOY_TARGET_ALIASES[target as keyof typeof DEPLOY_TARGET_ALIASES];
      if (!resolved) {
        throw new Error(
          `Unsupported target "${target}". Use claude, cursor, chatgpt, codex, antigravity, installed, or all.`,
        );
      }
      return resolved;
    });
  if (targets.length === 0) {
    throw new Error('--targets requires at least one target app.');
  }
  const unique = [...new Set(targets)];
  if (global) {
    const allowed = new Set<string>(getGlobalPersonaSyncTargets());
    const unsupported = unique.filter((target) => !allowed.has(target));
    if (unsupported.length > 0) {
      throw new Error(
        `Target(s) not supported with --global: ${unsupported.join(', ')}. ` +
          'Cursor (and other project-only hosts) need --project. ' +
          `Global targets: ${[...allowed].join(', ')}.`,
      );
    }
  }
  return unique;
}

async function deployRoot(parsed: ParsedArgs): Promise<string> {
  const input = optionalFlag(parsed, 'project') ?? optionalFlag(parsed, 'root');
  if (!input) {
    throw new Error(
      '--project <folder> is required. Ask which project should receive the Persona, or use --global to apply it on this device for all projects and sessions.',
    );
  }
  const normalized =
    input === '~' || input.toLowerCase() === 'home' ? os.homedir() : input;
  const { root } = await resolvePersonaRoot(normalized);
  let rootStat: Awaited<ReturnType<typeof stat>>;
  try {
    rootStat = await stat(root);
  } catch {
    throw new Error(`Project folder does not exist: ${root}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Project path is not a folder: ${root}`);
  }
  return root;
}

async function resolveDeployDestination(parsed: ParsedArgs): Promise<{
  root: string;
  targets: string[];
  mode: 'project' | 'global';
}> {
  // `--installed` remains a compatibility alias for the former public syntax.
  const global =
    parsed.flags.get('global') === 'true' ||
    parsed.flags.get('installed') === 'true';
  if (global) {
    const detected = detectInstalledHostConfigTargets();
    if (detected.targets.length === 0) {
      throw new Error(NO_GLOBAL_HOSTS_ERROR);
    }
    return {
      root: detected.root,
      targets: deployTargets(parsed, detected.targets, { global: true }),
      mode: 'global',
    };
  }
  return {
    root: await deployRoot(parsed),
    targets: deployTargets(parsed),
    mode: 'project',
  };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function checkedPersonaListing(
  root: string | undefined,
  requestedPersona: string | undefined,
) {
  const listing = await listPersona(root, requestedPersona);
  if (
    requestedPersona &&
    listing.persona !== assertPersonaId(requestedPersona)
  ) {
    throw new Error(`Persona "${requestedPersona}" does not exist.`);
  }
  return listing;
}

async function readSaveContent(parsed: ParsedArgs): Promise<string> {
  const contentFile = optionalFlag(parsed, 'content-file');
  if (parsed.stdin === Boolean(contentFile)) {
    throw new Error('Use exactly one of --stdin or --content-file <path>.');
  }
  if (contentFile) return readFile(contentFile, 'utf8');

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readBatchChanges(batchFile: string) {
  const manifest: unknown = JSON.parse(await readFile(batchFile, 'utf8'));
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !Array.isArray((manifest as { changes?: unknown }).changes)
  ) {
    throw new Error('Batch file must contain a changes array.');
  }

  return Promise.all(
    (manifest as { changes: unknown[] }).changes.map(async (value, index) => {
      if (!value || typeof value !== 'object') {
        throw new Error(`Batch change ${index + 1} must be an object.`);
      }
      const entry = value as Record<string, unknown>;
      const bundlePath =
        typeof entry.path === 'string' ? entry.path.trim() : '';
      const contentFile =
        typeof entry.contentFile === 'string' ? entry.contentFile.trim() : '';
      const deleting = entry.delete === true;
      if (!bundlePath) {
        throw new Error(`Batch change ${index + 1} requires path.`);
      }
      if (Object.hasOwn(entry, 'delete') && !deleting) {
        throw new Error(`Batch change ${index + 1} delete must be true.`);
      }
      if (deleting === Boolean(contentFile)) {
        throw new Error(
          `Batch change ${index + 1} requires exactly one of contentFile or delete: true.`,
        );
      }
      return deleting
        ? ({ bundlePath, delete: true } as const)
        : ({ bundlePath, bytes: await readFile(contentFile) } as const);
    }),
  );
}

export async function cmdPersona(args: string[]): Promise<void> {
  const [operation, ...rest] = args;
  if (!operation || operation === 'help' || operation === '--help') {
    process.stdout.write(
      `${PERSONA_USAGE}

  transcodes persona list [--persona NAME] [--root PATH]
  transcodes persona create NAME
  transcodes persona read --persona NAME --kind agent|rule|skill [--name NAME] [--file SKILL_FILE]
  transcodes persona save --persona NAME --kind agent|rule|skill [--name NAME] [--file SKILL_FILE] (--stdin | --content-file PATH)
  transcodes persona save --persona NAME --batch-file MANIFEST.json
      --file targets a companion file inside a skill folder (e.g. scripts/extract.py,
      references/billing-api.md); omit it to read/save the skill's SKILL.md.
  transcodes persona delete NAME
  transcodes persona delete-file --persona NAME --kind agent|rule|skill [--name NAME]
  transcodes persona delete-reference --persona NAME --file references/billing-api.md
  transcodes persona deploy --persona NAME --project FOLDER --targets claude,cursor,chatgpt,antigravity|all --yes
  transcodes persona deploy --persona NAME --global [--targets claude,chatgpt,antigravity] --yes
  transcodes persona deploy ... --dry-run   (list what would be written and deleted; writes nothing, no --yes needed)
  transcodes persona push --persona NAME [--tag TAG]
  transcodes persona pull --persona NAME[@REVISION] [--revision N]
  transcodes persona log --persona NAME
  transcodes persona tag --persona NAME --revision N [--tag TAG | --delete]
`,
    );
    return;
  }

  const parsed = parseArgs(rest);
  switch (operation) {
    case 'list': {
      printJson(
        await checkedPersonaListing(
          optionalFlag(parsed, 'root'),
          optionalFlag(parsed, 'persona'),
        ),
      );
      return;
    }
    case 'create': {
      const name = parsed.positionals[0] ?? optionalFlag(parsed, 'name');
      if (!name) throw new Error('Persona name is required.');
      printJson({ persona: await createPersona(name) });
      return;
    }
    case 'read': {
      const root = optionalFlag(parsed, 'root');
      const persona = requiredFlag(parsed, 'persona');
      const kind = personaKind(parsed);
      await checkedPersonaListing(root, persona);
      printJson(
        await readPersonaFile({
          root,
          persona,
          kind,
          name: optionalFlag(parsed, 'name'),
          file: skillFileFlag(parsed, kind),
        }),
      );
      return;
    }
    case 'save': {
      if (parsed.flags.has('batch-file')) {
        const batchFile = requiredFlag(parsed, 'batch-file');
        const unsupported = [...parsed.flags.keys()].find(
          (flag) => !['batch-file', 'root', 'persona'].includes(flag),
        );
        if (parsed.stdin || unsupported || parsed.positionals.length > 0) {
          throw new Error(
            '--batch-file cannot be combined with other save flags.',
          );
        }
        printJson(
          await savePersonaBatch({
            root: optionalFlag(parsed, 'root'),
            persona: requiredFlag(parsed, 'persona'),
            changes: await readBatchChanges(batchFile),
          }),
        );
        return;
      }
      const kind = personaKind(parsed);
      const content = await readSaveContent(parsed);
      printJson(
        await savePersonaFile({
          root: optionalFlag(parsed, 'root'),
          persona: requiredFlag(parsed, 'persona'),
          kind,
          name: optionalFlag(parsed, 'name'),
          file: skillFileFlag(parsed, kind),
          content,
        }),
      );
      return;
    }
    case 'delete': {
      const name = parsed.positionals[0] ?? optionalFlag(parsed, 'persona');
      if (!name) throw new Error('Persona name is required.');
      const persona = await deletePersona(name);
      await clearPersonaSyncRevision(persona);
      printJson({ persona, deleted: true });
      return;
    }
    case 'delete-file': {
      const root = optionalFlag(parsed, 'root');
      const persona = requiredFlag(parsed, 'persona');
      const kind = personaKind(parsed);
      const unsupported = [...parsed.flags.keys()].find(
        (flag) => !['root', 'persona', 'kind', 'name'].includes(flag),
      );
      if (unsupported || parsed.stdin || parsed.positionals.length > 0) {
        throw new Error(
          'Skill companion deletion requires persona save --batch-file; delete-file removes a whole agent, rule, or Skill.',
        );
      }
      const name = optionalFlag(parsed, 'name');
      if (kind === 'agent' && name) {
        throw new Error('--name does not apply to --kind agent.');
      }
      await checkedPersonaListing(root, persona);
      printJson(
        await deletePersonaFile({
          root,
          persona,
          kind,
          name,
        }),
      );
      return;
    }
    case 'delete-reference': {
      const root = optionalFlag(parsed, 'root');
      const persona = requiredFlag(parsed, 'persona');
      const file = requiredFlag(parsed, 'file');
      await checkedPersonaListing(root, persona);
      printJson(
        await deleteSkillPath({
          root,
          persona,
          name: KNOWLEDGE_BASE_SKILL_NAME,
          path: file,
        }),
      );
      return;
    }
    case 'deploy': {
      const persona = requiredFlag(parsed, 'persona');
      const { root, targets, mode } = await resolveDeployDestination(parsed);
      await checkedPersonaListing(root, persona);
      // --dry-run writes nothing, so it skips the confirmation gate: it is the
      // way to see what deploy would overwrite and delete before confirming.
      const dryRun = parsed.flags.get('dry-run') === 'true';
      if (!dryRun && parsed.flags.get('yes') !== 'true') {
        throw new Error(
          [
            'Deploy refused: confirmation required.',
            `Persona "${assertPersonaId(persona)}" will overwrite generated agent files for [${targets.join(', ')}] under ${root} (${mode}).`,
            mode === 'global'
              ? 'Existing files it does not produce are left alone.'
              : 'It will also delete generated files under that project folder that this Persona no longer produces.',
            'Re-run with --dry-run to list exactly what would be written and deleted.',
            'Ask the user to confirm, then re-run the same deploy command with --yes.',
          ].join(' '),
        );
      }
      const result = await deployPersona({
        root,
        persona,
        targets,
        global: mode === 'global',
        dryRun,
      });
      if (!result.ok) {
        throw new Error(result.output || 'Persona deployment failed.');
      }
      printJson({
        persona: assertPersonaId(persona),
        root,
        targets,
        mode,
        dryRun,
        configDirs:
          mode === 'global'
            ? {
                claude: path.join(root, '.claude'),
                codex: path.join(root, '.codex'),
                antigravity: path.join(root, '.gemini'),
              }
            : undefined,
        ...result,
      });
      return;
    }
    case 'push': {
      const persona = requiredFlag(parsed, 'persona');
      const tag = optionalFlag(parsed, 'tag');
      printJson(await pushPersonaSync(persona, tag));
      return;
    }
    case 'pull': {
      let persona = requiredFlag(parsed, 'persona');
      let ref = optionalFlag(parsed, 'ref') ?? optionalFlag(parsed, 'revision');
      if (persona.includes('@')) {
        const [p, r] = persona.split('@', 2);
        persona = p!;
        ref = ref ?? r;
      }
      printJson(await pullPersonaSync(persona, ref));
      return;
    }
    case 'log':
    case 'history':
    case 'revisions': {
      const persona = parsed.positionals[0] ?? requiredFlag(parsed, 'persona');
      const config = loadPersonaConfig();
      printJson(await fetchPersonaRevisions(config, persona));
      return;
    }
    case 'tag': {
      const persona = requiredFlag(parsed, 'persona');
      const revStr = requiredFlag(parsed, 'revision');
      const revision = Number.parseInt(revStr, 10);
      if (Number.isNaN(revision)) {
        throw new Error('--revision must be an integer.');
      }
      const isDelete = parsed.flags.get('delete') === 'true';
      const tag = isDelete ? null : requiredFlag(parsed, 'tag');
      const config = loadPersonaConfig();
      printJson(await updatePersonaTag(config, persona, revision, tag));
      return;
    }
    default:
      throw new Error(
        `unknown Persona command "${operation}". ${PERSONA_USAGE}`,
      );
  }
}
