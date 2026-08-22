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
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
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
import {
  createFeatureScaffold,
  TRANSCODES_ATTRIBUTION_OUTPUT_MARKER,
  transcodesAttributionOutputLine,
} from '../sync/lib/feature-scaffold.js';
import { parseFrontmatter } from '../sync/utils/frontmatter.js';

const execFileAsync = promisify(execFile);

export type PersonaKind = 'agent' | 'rule' | 'skill';

export type PersonaEntry = {
  name: string;
  /** Path relative to the project root, e.g. `.transcodes/rules/backend.md`. */
  relativePath: string;
  /**
   * Skill-root-relative POSIX paths of every file in the Skill folder
   * (SKILL.md first). Only present for skills.
   */
  files?: string[];
  /**
   * Skill-root-relative POSIX paths of every directory in the Skill folder,
   * including empty ones (so freshly created folders show up in the
   * dashboard). Only present for skills.
   */
  dirs?: string[];
};

/** One knowledge document inside the reserved knowledge-base Skill. */
export type PersonaKnowledgeReference = {
  /** Skill-root-relative path, e.g. `references/api-spec.md`. */
  file: string;
  /** Frontmatter `name`, falling back to the file name. */
  name: string;
  /** Frontmatter `description`; empty when the file does not declare one. */
  description: string;
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
  /**
   * The reserved knowledge-base Skill. Its references are the Persona's
   * knowledge documents; the Skill itself is generated, not authored.
   */
  knowledge: {
    exists: boolean;
    skill: string;
    references: PersonaKnowledgeReference[];
  };
};

/** Per-file cap for dashboard create/save. */
export const MAX_PERSONA_FILE_BYTES = 5 * 1024 * 1024;

export function assertPersonaFileSize(bytes: number): void {
  if (bytes > MAX_PERSONA_FILE_BYTES) {
    throw new Error('Files larger than 5 MB cannot be added.');
  }
}

const PERSONA_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export type PersonaFile = {
  kind: PersonaKind;
  name: string;
  /** Skill-root-relative path of the file being read/saved (skills only). */
  file?: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  /** True when the file is not UTF-8 text; `content` is empty then. */
  binary?: boolean;
  content: string;
};

export type PersonaDeployResult = {
  ok: boolean;
  exitCode: number;
  output: string;
};

/** Same fence as the backend persona/skill name: no traversal, no spaces. */
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const NAME_RULE =
  'letters, numbers, dots, underscores, or hyphens, e.g. billing-api or voice_01';

function normalizePersonaName(name: string): string {
  const trimmed = name.trim().replace(/\.md$/i, '').replace(/\s+/g, '-');
  if (!NAME_PATTERN.test(trimmed)) {
    throw new Error(`Invalid name "${name}". Use ${NAME_RULE}.`);
  }
  return trimmed;
}
const LAST_ROOT_FILE = 'dashboard-persona.json';
const PERSONAS_DIR_NAME = 'personas';
const PERSONA_INSTRUCTION_DIR_NAME = 'instruction';

/**
 * Reserved Skill every Persona ships with. It holds no workflow of its own —
 * each file under its `references/` folder is one knowledge document, and its
 * SKILL.md is a generated index the agent reads to decide what to open.
 */
export const KNOWLEDGE_BASE_SKILL_NAME = 'knowledge-base';
const KNOWLEDGE_BASE_REFERENCE_DIR = 'references';
export const KNOWLEDGE_BASE_STARTER_NAME = 'what-belongs-here';

/** One Markdown knowledge document with required name / description frontmatter. */
export function knowledgeReferenceDocument(params: {
  title: string;
  description: string;
  facts: string[];
}): string {
  return `---
name: ${JSON.stringify(params.title)}
description: ${JSON.stringify(params.description)}
---

# Knowledge
${params.facts.map((line) => `- ${line}`).join('\n')}
`;
}

export const KNOWLEDGE_BASE_STARTER_CONTENT = knowledgeReferenceDocument({
  title: 'What belongs in Knowledge Base',
  description:
    'Read this before adding a knowledge document, or when deciding whether a fact belongs here instead of a Rule or Skill.',
  facts: [
    'Put durable facts the agent must not guess: product names, URLs, token names, brand decisions, approved claims, API contracts.',
    'Each entry needs a Title and a Description that answers “When should this knowledge be referenced?”',
    'Write the fact as the answer itself, not as a reminder to look it up later.',
    'Do not put Must/Never policy here — that belongs in a Rule.',
    'Do not put a step-by-step workflow here — that belongs in a Skill.',
    'New file names must be lowercase kebab-case.md — `billing-api.md`, not `BillingAPI.md` or `billing_api.md`.',
  ],
});

const KNOWLEDGE_BASE_PREREQUISITE_KEBAB =
  '- Reference file names are lowercase kebab-case: `references/design-tokens.md`.';

const KNOWLEDGE_BASE_STEPS = `1. Match the information the task needs against the descriptions in References.
2. If a description matches, read that reference before answering; do not guess what it contains.
3. If no reference matches, say that this is not in the Knowledge Base. Then either answer from general knowledge and label it as such, or ask the user for the missing fact. Do not invent a project-specific fact, and do not fail the task just because a reference is missing.
4. When durable new knowledge appears, store it as a new file under \`${KNOWLEDGE_BASE_REFERENCE_DIR}/\`. The file name must be lowercase kebab-case plus \`.md\` (e.g. \`design-tokens.md\`, not \`DesignTokens.md\` or \`design_tokens.md\`). Give it non-empty \`name\` and \`description\` frontmatter; the description answers “When should this knowledge be referenced?”
`;

const KNOWLEDGE_BASE_OUTPUT = `**Deliverable** — an answer grounded in the references that were actually read, or an answer that states no matching reference was found.
**Done when** — no project-specific claim was guessed, and a missing reference was disclosed instead of invented.
`;

const KNOWLEDGE_BASE_SKILL_TEMPLATE = `---
name: ${KNOWLEDGE_BASE_SKILL_NAME}
description: Stores all knowledge this Persona has accumulated. Read the reference whose description matches the information the current task needs.
---

# Prerequisites
- Every file under \`${KNOWLEDGE_BASE_REFERENCE_DIR}/\` is one knowledge document with its own name and description.
- The References list below is generated from those files; do not hand-edit it.
${KNOWLEDGE_BASE_PREREQUISITE_KEBAB}

# Steps
${KNOWLEDGE_BASE_STEPS}
# Output
${KNOWLEDGE_BASE_OUTPUT}`;

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
  try {
    return normalizePersonaName(name);
  } catch {
    throw new Error(`Invalid ${kind} name "${name}". Use ${NAME_RULE}.`);
  }
}

/**
 * File name for a knowledge document. Title is free text; the on-disk name
 * is a slug so it stays a valid Skill path segment.
 */
export function knowledgeFileSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[_\s.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new Error('Title must include at least one letter or number.');
  }
  return assertPersonaName('skill', slug);
}

/**
 * Validate a Skill-root-relative file path from the dashboard. Every segment
 * must start with an alphanumeric character, which also rules out `..` and
 * dotfiles. Empty input means the mandatory SKILL.md.
 */
export function assertSkillFilePath(file: string): string {
  const normalized = file.trim();
  if (!normalized) return SKILL_FILE_NAME;
  if (normalized.includes('\\')) {
    throw new Error(`Invalid Skill file path "${file}".`);
  }
  for (const segment of normalized.split('/')) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/.test(segment) || /\s$/.test(segment)) {
      throw new Error(`Invalid Skill file path "${file}".`);
    }
  }
  return normalized;
}

/** Creating or saving under references/ is Markdown-only. Delete and read are not. */
function assertSkillReferenceWritePath(file: string): void {
  const last = file.split('/').pop() ?? '';
  if (
    file.startsWith('references/') &&
    /\.[a-z0-9]+$/i.test(last) &&
    !/\.md$/i.test(last)
  ) {
    throw new Error(
      'Reference files must be Markdown (.md). Put PDFs and images in assets/ if the workflow needs the original file.',
    );
  }
}

function assertKnowledgeBaseReferencePath(file: string): void {
  if (
    !file.startsWith(`${KNOWLEDGE_BASE_REFERENCE_DIR}/`) ||
    !file.toLowerCase().endsWith('.md')
  ) {
    throw new Error(
      `The reserved "${KNOWLEDGE_BASE_SKILL_NAME}" Skill only allows Markdown files under ${KNOWLEDGE_BASE_REFERENCE_DIR}/. Its ${SKILL_FILE_NAME} is managed automatically.`,
    );
  }
}

function assertKnowledgeBaseReferenceWritePath(file: string): void {
  assertKnowledgeBaseReferencePath(file);
  const base = file.slice(`${KNOWLEDGE_BASE_REFERENCE_DIR}/`.length);
  if (base.includes('/')) {
    throw new Error(
      `Knowledge files must sit directly under ${KNOWLEDGE_BASE_REFERENCE_DIR}/ as lowercase kebab-case.md.`,
    );
  }
  const slug = base.replace(/\.md$/i, '');
  if (slug !== knowledgeFileSlug(slug)) {
    throw new Error(
      `Knowledge file names must be lowercase kebab-case.md (e.g. ${KNOWLEDGE_BASE_REFERENCE_DIR}/billing-api.md). Got "${file}".`,
    );
  }
}

function assertKnowledgeBaseReferenceContent(
  file: string,
  content: string,
): void {
  const parsed = parseFrontmatter(content, file);
  const name =
    typeof parsed.frontmatter.name === 'string'
      ? parsed.frontmatter.name.trim()
      : '';
  const description =
    typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description.trim()
      : '';
  if (!parsed.hasFrontmatter || !name || !description) {
    throw new Error(
      `Knowledge reference "${file}" requires non-empty name and description frontmatter.`,
    );
  }
}

const SCRIPT_SECTION = '# Available scripts';
const REFERENCE_SECTION = '# References';

// Hints the CLI has written into these sections over time. Older wording stays
// listed so an existing SKILL.md still reconciles (and gets upgraded) instead
// of collecting duplicate bullets.
const LEGACY_SCRIPT_HINTS = ['run this when the workflow needs this helper'];
const LEGACY_REFERENCE_HINTS = [
  'read this when you need the detailed reference',
];

/** Best-effort interpreter for the run command shown in the bullet. */
function scriptRunCommand(file: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
  if (ext === 'py') return `python3 ${file}`;
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return `node ${file}`;
  if (ext === 'ts' || ext === 'mts') return `npx tsx ${file}`;
  if (ext === 'sh' || ext === 'bash') return `bash ${file}`;
  return file;
}

// A companion only gets used when a Step tells the agent to use it, so the
// bullet names the command and closes the "I'll just do it myself" shortcut.
function scriptHint(file: string): string {
  return `run \`${scriptRunCommand(file)}\` from the Step that needs it; do not hand-write that work`;
}

function referenceHint(_file: string): string {
  return 'read this from the Step that needs it; do not guess what it contains';
}

function isMentionableCompanion(file: string): boolean {
  if (file.endsWith('/.gitkeep') || file === '.gitkeep') return false;
  return file.startsWith('scripts/') || file.startsWith('references/');
}

function alreadyMentionsCompanion(content: string, filePath: string): boolean {
  const visible = content.replace(/<!--[\s\S]*?-->/g, '');
  const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    visible.includes(`\`${filePath}\``) ||
    new RegExp(
      `(^|[^a-zA-Z0-9._/-])${escapedPath}($|[^a-zA-Z0-9._/-])`,
      'm',
    ).test(visible)
  );
}

/**
 * List each companion under `# Available scripts` or `# References`.
 * Do not rewrite `# Steps` — the agent writes the run/read command into
 * the numbered step that uses the file.
 *
 * `knowledge` switches the References section to `name — description — path`
 * bullets sourced from each reference's own frontmatter. Only the
 * knowledge-base Skill uses that form; every other Skill keeps the hint form.
 */
export function mentionSkillCompanions(
  skillMd: string,
  companionPaths: string[],
  knowledge?: Map<string, PersonaKnowledgeReference>,
): string {
  const unique = [...new Set(companionPaths.filter(isMentionableCompanion))];
  let next = skillMd.replace(/\r\n/g, '\n');
  next = ensureCompanionSection({
    content: next,
    heading: SCRIPT_SECTION,
    paths: unique.filter((file) => file.startsWith('scripts/')),
    hintFor: scriptHint,
    legacyHints: LEGACY_SCRIPT_HINTS,
    dirPrefix: 'scripts/',
  });
  const references = unique.filter((file) => file.startsWith('references/'));
  next = knowledge
    ? ensureKnowledgeReferenceSection(next, references, knowledge)
    : ensureCompanionSection({
        content: next,
        heading: REFERENCE_SECTION,
        paths: references,
        hintFor: referenceHint,
        legacyHints: LEGACY_REFERENCE_HINTS,
        dirPrefix: 'references/',
      });
  return next;
}

/** Any generated knowledge bullet ends with the `— ./references/<file>` path. */
const KNOWLEDGE_BULLET = /^- [^\n]*— \.\/references\/[^\n]*\n?/gm;
/** Hint-form bullets written before the knowledge-base format existed. */
const LEGACY_KNOWLEDGE_BULLET = /^- `references\/[^`\n]*`[^\n]*\n?/gm;

export function knowledgeReferenceBullet(
  reference: PersonaKnowledgeReference,
): string {
  const description =
    reference.description ||
    'no description yet — add one to this file’s frontmatter';
  return `- ${reference.name} — ${description} — ./${reference.file}`;
}

/**
 * Own the References section of the knowledge-base Skill: one bullet per
 * reference file, rewritten from the current frontmatter so renames and
 * description edits propagate, and dropped as soon as the file is gone.
 * Prose written above or below the bullets is preserved.
 */
function ensureKnowledgeReferenceSection(
  content: string,
  files: string[],
  knowledge: Map<string, PersonaKnowledgeReference>,
): string {
  const bullets = files.map((file) =>
    knowledgeReferenceBullet(
      knowledge.get(file) ?? fallbackKnowledgeReference(file),
    ),
  );
  const section = findHeadingSection(content, REFERENCE_SECTION);
  if (!section) {
    if (bullets.length === 0) return content;
    return insertSectionBeforeOutput(
      content,
      `${REFERENCE_SECTION}\n${bullets.join('\n')}\n`,
    );
  }

  const kept = section.body
    .replace(KNOWLEDGE_BULLET, '')
    .replace(LEGACY_KNOWLEDGE_BULLET, '')
    .replace(/\s+$/, '');
  if (!kept && bullets.length === 0) {
    const before = content.slice(0, section.headingStart).replace(/\n+$/, '');
    const after = content.slice(section.end).replace(/^\n+/, '');
    return [before, after].filter(Boolean).join('\n\n');
  }
  const joined = [kept, ...bullets].filter(Boolean).join('\n');
  return `${content.slice(0, section.bodyStart)}${joined}\n\n${content.slice(section.end)}`;
}

const COMPANION_BULLET = /^- `([^`\n]+)` — ([^\n]*)\n?/gm;

function ensureCompanionSection({
  content,
  heading,
  paths,
  hintFor,
  legacyHints,
  dirPrefix,
}: {
  content: string;
  heading: string;
  paths: string[];
  hintFor: (file: string) => string;
  legacyHints: string[];
  dirPrefix: string;
}): string {
  const section = findHeadingSection(content, heading);
  const isGenerated = (file: string, text: string) =>
    text.trim() === hintFor(file) || legacyHints.includes(text.trim());
  if (section) {
    const placeholder = new RegExp(`^- \`${dirPrefix}\` —[^\\n]*\\n?`, 'm');
    const actualPaths = new Set(paths);
    let body = section.body.replace(
      COMPANION_BULLET,
      (line, file: string, text: string) => {
        if (!isGenerated(file, text)) return line;
        if (!actualPaths.has(file)) return '';
        // Rewrite so an older hint picks up the current wording.
        return `- \`${file}\` — ${hintFor(file)}\n`;
      },
    );
    if (paths.length > 0) body = body.replace(placeholder, '');

    const reconciled = `${content.slice(0, section.bodyStart)}${body}${content.slice(section.end)}`;
    const missing = paths.filter(
      (file) => !alreadyMentionsCompanion(reconciled, file),
    );
    const bullets = missing.map((file) => `- \`${file}\` — ${hintFor(file)}`);
    const trimmedBody = body.replace(/\s+$/, '');
    if (!trimmedBody && bullets.length === 0) {
      const before = content.slice(0, section.headingStart).replace(/\n+$/, '');
      const after = content.slice(section.end).replace(/^\n+/, '');
      return [before, after].filter(Boolean).join('\n\n');
    }

    const joined = [trimmedBody, ...bullets].filter(Boolean).join('\n');
    return `${content.slice(0, section.bodyStart)}${joined}\n\n${content.slice(section.end)}`;
  }

  const missing = paths.filter(
    (file) => !alreadyMentionsCompanion(content, file),
  );
  if (missing.length === 0) return content;
  const bullets = missing.map((file) => `- \`${file}\` — ${hintFor(file)}`);
  return insertSectionBeforeOutput(
    content,
    `${heading}\n${bullets.join('\n')}\n`,
  );
}

function findHeadingSection(
  content: string,
  heading: string,
): {
  headingStart: number;
  bodyStart: number;
  body: string;
  end: number;
} | null {
  const match = content.match(new RegExp(`^${heading}\\s*$`, 'm'));
  if (!match || match.index === undefined) return null;
  const bodyStart = match.index + match[0].length;
  const after = content.slice(bodyStart).replace(/^\n/, '');
  const afterStart = content.length - after.length;
  const nextHeading = after.search(/^# /m);
  const end = nextHeading === -1 ? content.length : afterStart + nextHeading;
  return {
    headingStart: match.index,
    bodyStart: afterStart,
    body: content.slice(afterStart, end),
    end,
  };
}

function replaceHeadingSection(
  content: string,
  heading: string,
  body: string,
): string {
  const section = findHeadingSection(content, heading);
  const block = body.endsWith('\n') ? body : `${body}\n`;
  if (!section) {
    return insertSectionBeforeOutput(content, `${heading}\n${block}`);
  }
  return `${content.slice(0, section.bodyStart)}${block}\n${content.slice(section.end)}`;
}

function applyKnowledgeBaseGuidance(content: string): string {
  let next = replaceHeadingSection(content, '# Steps', KNOWLEDGE_BASE_STEPS);
  next = replaceHeadingSection(next, '# Output', KNOWLEDGE_BASE_OUTPUT);
  if (!next.includes('kebab-case')) {
    const prerequisites = findHeadingSection(next, '# Prerequisites');
    if (prerequisites) {
      const body = prerequisites.body.replace(/\s+$/, '');
      next = `${next.slice(0, prerequisites.bodyStart)}${body}\n${KNOWLEDGE_BASE_PREREQUISITE_KEBAB}\n\n${next.slice(prerequisites.end)}`;
    }
  }
  return next;
}

function insertSectionBeforeOutput(content: string, block: string): string {
  const trimmed = content.replace(/\s+$/, '');
  const output = trimmed.search(/^# Output\s*$/m);
  if (output !== -1) {
    return `${trimmed.slice(0, output)}${block}\n${trimmed.slice(output)}`;
  }
  const comment = trimmed.search(/^<!--/m);
  if (comment !== -1) {
    return `${trimmed.slice(0, comment)}${block}\n${trimmed.slice(comment)}`;
  }
  return `${trimmed}\n\n${block}`;
}

function fallbackKnowledgeReference(file: string): PersonaKnowledgeReference {
  const base = file.split('/').pop() ?? file;
  return { file, name: base.replace(/\.md$/i, ''), description: '' };
}

/** Single-line `name` / `description` from a reference file's frontmatter. */
export function knowledgeReferenceIdentity(
  file: string,
  content: string,
): PersonaKnowledgeReference {
  const fallback = fallbackKnowledgeReference(file);
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter(content).frontmatter;
  } catch {
    // Broken YAML must not block the index; the file name still identifies it.
    return fallback;
  }
  const single = (value: unknown): string =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return {
    file,
    name: single(frontmatter.name) || fallback.name,
    description: single(frontmatter.description),
  };
}

/**
 * Read `name` / `description` for every reference of the knowledge-base Skill.
 * Returns undefined for any other Skill so the hint-form bullets stay intact.
 */
async function readKnowledgeReferences(
  bundleRoot: string,
  skillName: string,
  files: string[],
): Promise<Map<string, PersonaKnowledgeReference> | undefined> {
  if (skillName !== KNOWLEDGE_BASE_SKILL_NAME) return undefined;
  const references = new Map<string, PersonaKnowledgeReference>();
  for (const file of files) {
    if (!file.startsWith(`${KNOWLEDGE_BASE_REFERENCE_DIR}/`)) continue;
    const absolute = path.join(bundleRoot, 'skills', skillName, file);
    let content = '';
    try {
      content = await readFile(absolute, 'utf8');
    } catch {
      // A file listed but unreadable still belongs in the index.
    }
    references.set(file, knowledgeReferenceIdentity(file, content));
  }
  return references;
}

/**
 * List the knowledge documents of a Persona in the order SKILL.md indexes them.
 */
export async function listKnowledgeReferences(
  persona: string,
  files: string[],
): Promise<PersonaKnowledgeReference[]> {
  const references = await readKnowledgeReferences(
    personaDir(persona),
    KNOWLEDGE_BASE_SKILL_NAME,
    files,
  );
  return references ? [...references.values()] : [];
}

/**
 * Create the knowledge-base Skill when it is missing. New Personas get it up
 * front; Personas created before it existed (or pulled from another machine)
 * get it the first time a knowledge document is added.
 */
export async function ensureKnowledgeBaseSkill(persona: string): Promise<void> {
  const skillRoot = resolveInsidePersona(
    persona,
    path.posix.join('skills', KNOWLEDGE_BASE_SKILL_NAME),
  );
  const skillMdPath = path.join(skillRoot, SKILL_FILE_NAME);
  await mkdir(path.join(skillRoot, KNOWLEDGE_BASE_REFERENCE_DIR), {
    recursive: true,
  });
  if (await isFile(skillMdPath)) return;
  await writeFile(skillMdPath, KNOWLEDGE_BASE_SKILL_TEMPLATE, 'utf-8');
}

async function syncSkillCompanionMentions(
  persona: string,
  skillName: string,
): Promise<void> {
  const bundleRoot = personaDir(persona);
  const skillMdPath = path.join(
    bundleRoot,
    'skills',
    skillName,
    SKILL_FILE_NAME,
  );
  const current = await readFile(skillMdPath, 'utf8');
  const tree = await listSkillTree(bundleRoot, skillName);
  const guided =
    skillName === KNOWLEDGE_BASE_SKILL_NAME
      ? applyKnowledgeBaseGuidance(current)
      : current;
  const next = mentionSkillCompanions(
    guided,
    tree.files,
    await readKnowledgeReferences(bundleRoot, skillName, tree.files),
  );
  if (next === current) return;
  await writeFile(
    skillMdPath,
    next.endsWith('\n') ? next : `${next}\n`,
    'utf8',
  );
}

/**
 * Rebuild the generated `# References` bullets from `references/`, and keep
 * the `# Steps` / `# Output` guidance current. Hand-written sections such as
 * extra headings stay in place. Older Personas without a knowledge-base are
 * left untouched until their first knowledge document is created.
 */
export async function reconcileKnowledgeBaseIndex(
  personaInput: string,
): Promise<void> {
  const persona = assertPersonaId(personaInput);
  const skillMdPath = resolveInsidePersona(
    persona,
    path.posix.join('skills', KNOWLEDGE_BASE_SKILL_NAME, SKILL_FILE_NAME),
  );
  if (!(await isFile(skillMdPath))) return;
  await syncSkillCompanionMentions(persona, KNOWLEDGE_BASE_SKILL_NAME);
}

export function assertPersonaId(name: string): string {
  try {
    return normalizePersonaName(name);
  } catch {
    throw new Error(`Invalid Persona name "${name}". Use ${NAME_RULE}.`);
  }
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

async function assertNoSymlinkSegments(
  root: string,
  relativePath: string,
): Promise<void> {
  let current = root;
  for (const segment of ['', ...relativePath.split('/')]) {
    if (segment) current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Refusing to follow symbolic link: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

function assertPersonaBundlePath(
  bundlePath: string,
  deleting: boolean,
): string {
  if (!bundlePath || bundlePath.includes('\\')) {
    throw new Error(`Invalid Persona bundle path "${bundlePath}".`);
  }
  const parts = bundlePath.split('/');
  // An empty segment means a leading, doubled, or trailing slash. Without this
  // a trailing slash would reach assertSkillFilePath as '', take its SKILL.md
  // fallback, and return the raw path -- which resolves to the Skill directory.
  if (parts.some((part) => !part)) {
    throw new Error(`Invalid Persona bundle path "${bundlePath}".`);
  }
  if (
    parts.length === 2 &&
    parts[0] === PERSONA_INSTRUCTION_DIR_NAME &&
    parts[1]?.toLowerCase() === RULESYNC_OVERVIEW_FILE_NAME.toLowerCase()
  ) {
    return `${PERSONA_INSTRUCTION_DIR_NAME}/${RULESYNC_OVERVIEW_FILE_NAME}`;
  }
  if (parts.length === 2 && parts[0] === 'rules' && parts[1]?.endsWith('.md')) {
    const ruleName = assertPersonaName('rule', parts[1]);
    return `rules/${ruleName}.md`;
  }
  if (parts[0] === 'skills' && parts.length >= 2) {
    const skill = parts[1] ?? '';
    // A Skill directory is named for the Skill itself, and assertPersonaName
    // strips a `.md` suffix. Approving the raw segment would create a
    // `pdf.md` directory that every other command resolves to `pdf`.
    if (assertPersonaName('skill', skill) !== skill) {
      throw new Error(
        `Invalid Persona bundle path "${bundlePath}". Use "skills/${assertPersonaName('skill', skill)}/" for this Skill.`,
      );
    }
    if (parts.length === 2 && deleting) return bundlePath;
    if (parts.length >= 3) {
      const skillFile = assertSkillFilePath(parts.slice(2).join('/'));
      if (deleting && skillFile === SKILL_FILE_NAME) {
        throw new Error('SKILL.md is required and cannot be deleted.');
      }
      if (!deleting) assertSkillReferenceWritePath(skillFile);
      return `skills/${parts[1]}/${skillFile}`;
    }
  }
  throw new Error(`Invalid Persona bundle path "${bundlePath}".`);
}

export async function listPersonaIds(): Promise<string[]> {
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
  persona: string,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(source, 'utf-8');
  } catch {
    return;
  }

  const body = sanitizePersonaContent('agent', content, persona).replace(
    /\s+$/,
    '',
  );

  const frontmatter = `---
description: Transcodes Persona "${persona}"
cursor:
  alwaysApply: true
---

`;

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${frontmatter}${body}\n`, 'utf-8');
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
    const instruction = `${starterTemplate('agent', '', persona).replace(
      /\s+$/,
      '',
    )}\n`;
    await mkdir(path.dirname(instructionPath), { recursive: true });
    await writeFile(instructionPath, instruction, 'utf-8');
    await ensureKnowledgeBaseSkill(persona);
    await savePersonaFile({
      persona,
      kind: 'skill',
      name: KNOWLEDGE_BASE_SKILL_NAME,
      file: `${KNOWLEDGE_BASE_REFERENCE_DIR}/${KNOWLEDGE_BASE_STARTER_NAME}.md`,
      content: KNOWLEDGE_BASE_STARTER_CONTENT,
    });
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
      knowledge: {
        exists: false,
        skill: KNOWLEDGE_BASE_SKILL_NAME,
        references: [],
      },
    };
  }
  const persona =
    requestedPersona && personas.includes(requestedPersona)
      ? requestedPersona
      : personas[0]!;
  const bundleRoot = personaDir(persona);
  // Opening a Persona also repairs the generated index after files were
  // created, edited, or deleted directly in references/ outside the dashboard.
  await reconcileKnowledgeBaseIndex(persona);
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

  // The knowledge-base Skill ships with every Persona, so it must not make a
  // Persona that has no authored content look ready to apply.
  const knowledgeEntry = skills.find(
    (entry) => entry.name === KNOWLEDGE_BASE_SKILL_NAME,
  );
  const authoredSkills = skills.filter(
    (entry) => entry.name !== KNOWLEDGE_BASE_SKILL_NAME,
  );

  return {
    root,
    sotDir,
    persona,
    personas,
    personaDir: bundleRoot,
    initialized: agentExists || rules.length > 0 || authoredSkills.length > 0,
    agent: { exists: agentExists, relativePath: agentRelative },
    rules,
    skills,
    knowledge: {
      exists: !!knowledgeEntry,
      skill: KNOWLEDGE_BASE_SKILL_NAME,
      references: await listKnowledgeReferences(
        persona,
        knowledgeEntry?.files ?? [],
      ),
    },
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
    const tree = await listSkillTree(bundleRoot, name);
    entries.push({
      name,
      relativePath: personaRelativePath(persona, 'skill', name),
      files: tree.files,
      dirs: tree.dirs,
    });
  }
  return entries;
}

/**
 * Every file in a Skill folder as skill-root-relative POSIX paths. Dotfiles
 * and symlinks are skipped; SKILL.md sorts first, then remaining root files,
 * then folder contents alphabetically.
 */
async function listSkillTree(
  bundleRoot: string,
  skillName: string,
): Promise<{ files: string[]; dirs: string[] }> {
  const skillRoot = path.join(bundleRoot, 'skills', skillName);
  const files: string[] = [];
  const dirs: string[] = [];
  const walk = async (relativeDir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path.join(skillRoot, relativeDir), {
        withFileTypes: true,
      });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      const relative = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        dirs.push(relative);
        await walk(relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };
  await walk('');
  files.sort((a, b) => {
    if (a === SKILL_FILE_NAME) return -1;
    if (b === SKILL_FILE_NAME) return 1;
    const aNested = a.includes('/');
    const bNested = b.includes('/');
    if (aNested !== bNested) return aNested ? 1 : -1;
    return a.localeCompare(b);
  });
  dirs.sort((a, b) => a.localeCompare(b));
  return { files, dirs };
}

export type CollectedPersonaFile = {
  kind: PersonaKind;
  name: string;
  /** Bundle-relative POSIX path — the manifest `path` coordinate. */
  bundlePath: string;
  absolutePath: string;
};

/**
 * Enumerate the bundle for sync. `listPersona()` speaks project-root relative
 * paths; push/pull need the manifest coordinate (bundle-relative POSIX) plus
 * the on-disk location, and both directions must see the same enumeration.
 * A missing bundle is an empty list so pull can start from a blank machine.
 */
export async function collectPersonaFiles(
  personaInput: string,
): Promise<CollectedPersonaFile[]> {
  await ensurePersonaStorage();
  const persona = assertPersonaId(personaInput);
  const bundleRoot = personaDir(persona);
  if (!(await isDirectory(bundleRoot))) return [];
  // Push/hash callers use this enumeration without going through listPersona.
  // Reconcile first so the uploaded SKILL.md describes the actual references.
  await reconcileKnowledgeBaseIndex(persona);

  const files: CollectedPersonaFile[] = [];
  const agentBundlePath = personaBundleRelativePath('agent', '');
  const agentAbsolute = resolveInsidePersona(persona, agentBundlePath);
  if (await isFile(agentAbsolute)) {
    files.push({
      kind: 'agent',
      name: RULESYNC_OVERVIEW_FILE_NAME,
      bundlePath: agentBundlePath,
      absolutePath: agentAbsolute,
    });
  }
  for (const rule of await listRules(persona, bundleRoot)) {
    const bundlePath = personaBundleRelativePath('rule', rule.name);
    files.push({
      kind: 'rule',
      name: rule.name,
      bundlePath,
      absolutePath: resolveInsidePersona(persona, bundlePath),
    });
  }
  for (const skill of await listSkills(persona, bundleRoot)) {
    // The whole Skill folder syncs, not only SKILL.md — scripts, references,
    // and assets belong to the same versioned unit.
    for (const skillFile of skill.files ?? [SKILL_FILE_NAME]) {
      const bundlePath = path.posix.join('skills', skill.name, skillFile);
      files.push({
        kind: 'skill',
        name: skill.name,
        bundlePath,
        absolutePath: resolveInsidePersona(persona, bundlePath),
      });
    }
  }
  return files;
}

/**
 * Byte-verbatim write for pull. The server-provided `path` is trusted only
 * after `resolveInsidePersona()` re-anchors it inside the bundle; content is
 * written exactly as received so the manifest digest keeps matching.
 */
export async function writePersonaBundleFile(
  personaInput: string,
  bundlePath: string,
  bytes: Buffer,
): Promise<string> {
  await ensurePersonaStorage();
  const persona = assertPersonaId(personaInput);
  const absolutePath = resolveInsidePersona(persona, bundlePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return absolutePath;
}

/**
 * Replace a set of bundle files as one directory transaction.
 *
 * The existing bundle is copied to a hidden staging directory first, so files
 * absent from the remote manifest are preserved. Only after every replacement
 * has been written does the staged directory swap into place. If the swap
 * fails, the original directory is restored before the error escapes.
 */
export async function replacePersonaBundleFiles(
  personaInput: string,
  files: Array<{ bundlePath: string; bytes: Buffer }>,
  deletePaths: string[] = [],
): Promise<void> {
  await ensurePersonaStorage();
  const persona = assertPersonaId(personaInput);
  const bundleRoot = personaDir(persona);
  const transactionRoot = await mkdtemp(
    path.join(personasRoot(), '.persona-transaction-'),
  );
  const stagedRoot = path.join(transactionRoot, 'next');
  const previousRoot = path.join(transactionRoot, 'previous');
  let movedPrevious = false;
  let preserveTransaction = false;

  try {
    if (await isDirectory(bundleRoot)) {
      await cp(bundleRoot, stagedRoot, { recursive: true });
    } else {
      await mkdir(stagedRoot, { recursive: true });
    }

    for (const file of files) {
      // Validate against the real Persona root, then independently re-anchor
      // the same relative path inside staging.
      resolveInsidePersona(persona, file.bundlePath);
      await assertNoSymlinkSegments(bundleRoot, file.bundlePath);
      const stagedPath = path.resolve(stagedRoot, file.bundlePath);
      const rel = path.relative(stagedRoot, stagedPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(
          `Refusing to stage a path outside Persona "${persona}": ${file.bundlePath}`,
        );
      }
      await assertNoSymlinkSegments(stagedRoot, file.bundlePath);
      await mkdir(path.dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, file.bytes);
    }

    for (const bundlePath of deletePaths) {
      const absolutePath = resolveInsidePersona(persona, bundlePath);
      await assertNoSymlinkSegments(bundleRoot, bundlePath);
      try {
        await lstat(absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`"${bundlePath}" does not exist.`);
        }
        throw error;
      }
      await assertNoSymlinkSegments(stagedRoot, bundlePath);
      await rm(path.resolve(stagedRoot, bundlePath), {
        recursive: true,
        force: false,
      });
    }

    if (await isDirectory(bundleRoot)) {
      await rename(bundleRoot, previousRoot);
      movedPrevious = true;
    }

    try {
      await rename(stagedRoot, bundleRoot);
    } catch (error) {
      if (movedPrevious) {
        try {
          await rename(previousRoot, bundleRoot);
          movedPrevious = false;
        } catch (rollbackError) {
          preserveTransaction = true;
          throw new AggregateError(
            [error, rollbackError],
            `Persona swap and rollback failed; backup preserved at ${previousRoot}.`,
          );
        }
      }
      throw error;
    }
  } finally {
    if (!preserveTransaction) {
      await rm(transactionRoot, { recursive: true, force: true }).catch(
        () => {},
      );
    }
  }
}

export async function savePersonaBatch(params: {
  root?: string;
  persona: string;
  changes: Array<
    | { bundlePath: string; bytes: Buffer; delete?: false }
    | { bundlePath: string; delete: true }
  >;
}): Promise<{ persona: string; saved: string[]; deleted: string[] }> {
  const { root } = await resolvePersonaRoot(params.root);
  const persona = assertPersonaId(params.persona);
  if (!(await isDirectory(personaDir(persona)))) {
    throw new Error(`Persona "${persona}" does not exist.`);
  }
  if (params.changes.length === 0) {
    throw new Error('Batch must contain at least one change.');
  }

  const seen = new Set<string>();
  const files: Array<{ bundlePath: string; bytes: Buffer }> = [];
  const deletePaths: string[] = [];
  for (const change of params.changes) {
    const bundlePath = assertPersonaBundlePath(
      change.bundlePath,
      change.delete === true,
    );
    const conflict = [...seen].find(
      (other) =>
        other === bundlePath ||
        other.startsWith(`${bundlePath}/`) ||
        bundlePath.startsWith(`${other}/`),
    );
    if (conflict) {
      throw new Error(
        `Conflicting Persona bundle paths "${conflict}" and "${bundlePath}".`,
      );
    }
    seen.add(bundlePath);
    if (change.delete === true) {
      deletePaths.push(bundlePath);
    } else {
      let bytes = change.bytes;
      const parts = bundlePath.split('/');
      const isCompanion =
        parts[0] === 'skills' &&
        parts.length >= 3 &&
        parts.slice(2).join('/') !== SKILL_FILE_NAME;
      if (!isCompanion) {
        if (bytes.includes(0)) {
          throw new Error('Non-companion files must be plain text.');
        }
        const kind =
          parts[0] === PERSONA_INSTRUCTION_DIR_NAME
            ? 'agent'
            : parts[0] === 'rules'
              ? 'rule'
              : 'skill';
        let name = parts[1] ?? '';
        if (kind === 'rule') name = name.replace(/\.md$/i, '');
        let sanitized = sanitizePersonaContent(kind, bytes.toString('utf-8'));
        if (kind === 'skill') sanitized = synchronizeSkillName(sanitized, name);
        const text = `${sanitized.replace(/\s+$/, '')}\n`;
        bytes = Buffer.from(text, 'utf-8');
      }
      files.push({ bundlePath, bytes });
    }
  }

  const written = new Set(files.map((file) => file.bundlePath));
  for (const bundlePath of seen) {
    const parts = bundlePath.split('/');
    if (parts[0] !== 'skills' || parts.length < 3) continue;
    const skillFile = parts.slice(2).join('/');
    if (skillFile === SKILL_FILE_NAME) continue;
    const skillMdBundlePath = path.posix.join(
      'skills',
      parts[1] ?? '',
      SKILL_FILE_NAME,
    );
    await assertNoSymlinkSegments(personaDir(persona), skillMdBundlePath);
    if (
      !(await isFile(resolveInsidePersona(persona, skillMdBundlePath))) &&
      !written.has(skillMdBundlePath)
    ) {
      throw new Error(
        `Skill "${parts[1]}" has no ${SKILL_FILE_NAME}. Include it in the batch before changing companions.`,
      );
    }
    const indexedCompanion =
      skillFile === 'scripts' ||
      skillFile.startsWith('scripts/') ||
      skillFile === 'references' ||
      skillFile.startsWith('references/');
    const addedOrDeleted =
      deletePaths.includes(bundlePath) ||
      !(await isFile(resolveInsidePersona(persona, bundlePath)));
    // ponytail: the approved parent file owns semantic indexing; the CLI only
    // enforces that index-changing batches include it atomically.
    if (indexedCompanion && addedOrDeleted && !written.has(skillMdBundlePath)) {
      throw new Error(
        `Include the updated ${skillMdBundlePath} when adding or deleting indexed companions.`,
      );
    }
  }

  await replacePersonaBundleFiles(persona, files, deletePaths);
  await writeLastRoot(root);
  return {
    persona,
    saved: files.map((file) => file.bundlePath),
    deleted: deletePaths,
  };
}

export async function readPersonaFile(params: {
  root?: string;
  persona: string;
  kind: PersonaKind;
  name?: string;
  /** Skill-root-relative path of the file to read. Defaults to SKILL.md. */
  file?: string;
}): Promise<PersonaFile> {
  await resolvePersonaRoot(params.root);
  await ensurePersonaStorage();
  const persona = assertPersonaId(params.persona);
  const name = assertPersonaName(params.kind, params.name ?? '');
  const skillFile =
    params.kind === 'skill'
      ? assertSkillFilePath(params.file ?? '')
      : undefined;

  // Companion Skill files (scripts, references, assets) are read verbatim —
  // no frontmatter sanitizing and no starter template for missing files.
  if (skillFile && skillFile !== SKILL_FILE_NAME) {
    const bundlePath = path.posix.join('skills', name, skillFile);
    const absolutePath = resolveInsidePersona(persona, bundlePath);
    const relativePath = path.posix.join(
      RULESYNC_RELATIVE_DIR_PATH,
      PERSONAS_DIR_NAME,
      persona,
      bundlePath,
    );
    try {
      const bytes = await readFile(absolutePath);
      const binary = bytes.includes(0);
      return {
        kind: params.kind,
        name,
        file: skillFile,
        relativePath,
        absolutePath,
        exists: true,
        binary,
        content: binary ? '' : bytes.toString('utf-8'),
      };
    } catch {
      return {
        kind: params.kind,
        name,
        file: skillFile,
        relativePath,
        absolutePath,
        exists: false,
        content: '',
      };
    }
  }

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
      ...(skillFile ? { file: skillFile } : {}),
      relativePath,
      absolutePath,
      exists: true,
      content: sanitizePersonaContent(params.kind, content, persona),
    };
  } catch {
    return {
      kind: params.kind,
      name,
      ...(skillFile ? { file: skillFile } : {}),
      relativePath,
      absolutePath,
      exists: false,
      content: starterTemplate(params.kind, name, persona),
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

export async function readPersonaAsset(params: {
  root?: string;
  persona: string;
  name?: string;
  file: string;
}): Promise<{ file: string; contentType: string; bytes: Buffer }> {
  await resolvePersonaRoot(params.root);
  await ensurePersonaStorage();
  const persona = assertPersonaId(params.persona);
  const name = assertPersonaName('skill', params.name ?? '');
  const file = assertSkillFilePath(params.file);
  if (file === SKILL_FILE_NAME) {
    throw new Error('SKILL.md is not an image asset.');
  }
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  const contentType = PERSONA_IMAGE_TYPES[ext];
  if (!contentType) {
    throw new Error(`"${file}" is not a supported image.`);
  }
  const absolutePath = resolveInsidePersona(
    persona,
    path.posix.join('skills', name, file),
  );
  try {
    return { file, contentType, bytes: await readFile(absolutePath) };
  } catch {
    throw new Error(`"${file}" does not exist.`);
  }
}

const LEGACY_TRANSCODES_ATTRIBUTION_OUTPUT_MARKER =
  'When completing a task, end the response with exactly one short Transcodes attribution line';

const LEGACY_TRANSCODES_ATTRIBUTION_OUTPUT_LINES = new Set([
  '- When any Rule or Skill is applied, you MUST end the response with exactly one attribution line in this format: `Applied: Rules <comma-separated Rule names or none> · Skills <comma-separated Skill names or none>`. Use the exact Rule and Skill names, include every applied item, and never replace names with generic descriptions. Omit this line only when no Rule or Skill was applied.',
  '- If any Rules or Skills were applied, you MUST include a list of the names of the Rules and Skills in the response.',
  '- End each response with exactly one short line: `Applied: Rules <names> · Skills <names>`. Include names only, omit empty categories, and omit the entire line when no Rule or Skill was applied.',
  '- Start each response with exactly one short line: `Applied: Rules [<names>] · Skills [<names>]`. Include names only, omit empty categories, and omit the entire line when no Rule or Skill was applied.',
  '- Tell the user which Rules and Skills were applied in the response.',
  '- If any Rules or Skills were applied, you MUST briefly identify which ones in the response.',
]);

/** Keep mandatory Transcodes attribution in every generated host Instruction. */
export function ensurePersonaInstructionOutput(
  content: string,
  persona?: string,
): string {
  const lines = content.split(/\r?\n/);
  const outputLine = transcodesAttributionOutputLine(persona);
  const isAttributionLine = (line: string): boolean => {
    const normalized = line.trim();
    return (
      normalized.includes(TRANSCODES_ATTRIBUTION_OUTPUT_MARKER) ||
      normalized.includes(LEGACY_TRANSCODES_ATTRIBUTION_OUTPUT_MARKER) ||
      LEGACY_TRANSCODES_ATTRIBUTION_OUTPUT_LINES.has(normalized)
    );
  };

  const cleanLines = lines.filter((line) => !isAttributionLine(line));

  const outputIndex = cleanLines.findIndex(
    (line) => line.trim() === '# Output',
  );
  if (outputIndex >= 0) {
    let nextHeadingIndex = cleanLines.findIndex(
      (line, idx) => idx > outputIndex && line.trim().startsWith('# '),
    );
    if (nextHeadingIndex === -1) {
      nextHeadingIndex = cleanLines.length;
    }

    if (
      nextHeadingIndex > 0 &&
      cleanLines[nextHeadingIndex - 1].trim() !== ''
    ) {
      cleanLines.splice(nextHeadingIndex, 0, '', outputLine);
    } else {
      cleanLines.splice(nextHeadingIndex, 0, outputLine);
    }
    return cleanLines.join('\n');
  }

  const body = cleanLines.join('\n').replace(/\s+$/, '');
  return `${body}${body ? '\n\n' : ''}# Output\n\n${outputLine}\n`;
}

function sanitizePersonaContent(
  kind: PersonaKind,
  content: string,
  persona?: string,
): string {
  return kind === 'agent'
    ? ensurePersonaInstructionOutput(stripLeadingFrontmatter(content), persona)
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

function starterTemplate(
  kind: PersonaKind,
  name: string,
  persona?: string,
): string {
  const scaffold = createFeatureScaffold({
    feature: kind === 'skill' ? 'skill' : 'rule',
    name: kind === 'agent' ? 'agents' : name,
  });
  return sanitizePersonaContent(kind, scaffold.content, persona);
}

export async function savePersonaFile(params: {
  root?: string;
  persona: string;
  kind: PersonaKind;
  name?: string;
  /** Skill-root-relative path of the file to save. Defaults to SKILL.md. */
  file?: string;
  content: string;
}): Promise<PersonaFile> {
  const { root } = await resolvePersonaRoot(params.root);
  await ensurePersonaStorage();
  const persona = assertPersonaId(params.persona);
  if (!(await isDirectory(personaDir(persona)))) {
    throw new Error(`Persona "${persona}" does not exist.`);
  }
  const name = assertPersonaName(params.kind, params.name ?? '');
  const skillFile =
    params.kind === 'skill'
      ? assertSkillFilePath(params.file ?? '')
      : undefined;
  if (skillFile) {
    assertSkillReferenceWritePath(skillFile);
  }
  assertPersonaFileSize(Buffer.byteLength(params.content, 'utf-8'));
  if (params.kind === 'skill' && name === KNOWLEDGE_BASE_SKILL_NAME) {
    if (!skillFile || skillFile === SKILL_FILE_NAME) {
      throw new Error(
        `${KNOWLEDGE_BASE_SKILL_NAME}/${SKILL_FILE_NAME} is managed automatically and cannot be saved directly.`,
      );
    }
    assertKnowledgeBaseReferenceWritePath(skillFile);
    assertKnowledgeBaseReferenceContent(skillFile, params.content);
    // Covers Personas created before knowledge-base became a default Skill.
    await ensureKnowledgeBaseSkill(persona);
  }

  // Companion Skill files are written verbatim: scripts and reference docs
  // must not get frontmatter name-sync or Markdown sanitizing. After the
  // write, SKILL.md is patched so the new path is listed for the next agent.
  if (skillFile && skillFile !== SKILL_FILE_NAME) {
    const bundlePath = path.posix.join('skills', name, skillFile);
    const absolutePath = resolveInsidePersona(persona, bundlePath);
    const skillMdPath = resolveInsidePersona(
      persona,
      path.posix.join('skills', name, SKILL_FILE_NAME),
    );
    if (!(await isFile(skillMdPath))) {
      throw new Error(
        `Skill "${name}" has no ${SKILL_FILE_NAME}. Save ${SKILL_FILE_NAME} before adding "${skillFile}".`,
      );
    }
    const existed = await isFile(absolutePath);
    const previous = existed ? await readFile(absolutePath) : undefined;
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, params.content, 'utf-8');
    try {
      await syncSkillCompanionMentions(persona, name);
    } catch (error) {
      try {
        if (previous) await writeFile(absolutePath, previous);
        else await rm(absolutePath, { force: true });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Failed to update ${SKILL_FILE_NAME} and roll back "${skillFile}".`,
        );
      }
      throw error;
    }
    await writeLastRoot(root);
    return {
      kind: params.kind,
      name,
      file: skillFile,
      relativePath: path.posix.join(
        RULESYNC_RELATIVE_DIR_PATH,
        PERSONAS_DIR_NAME,
        persona,
        bundlePath,
      ),
      absolutePath,
      exists: true,
      content: params.content,
    };
  }

  const relativePath = personaRelativePath(persona, params.kind, name);
  const absolutePath = resolveInsidePersona(
    persona,
    personaBundleRelativePath(params.kind, name),
  );

  const sanitized = sanitizePersonaContent(
    params.kind,
    params.content,
    persona,
  );
  const synchronized =
    params.kind === 'skill' ? synchronizeSkillName(sanitized, name) : sanitized;
  let content = `${synchronized.replace(/\s+$/, '')}\n`;
  if (params.kind === 'skill') {
    const bundleRoot = personaDir(persona);
    const tree = await listSkillTree(bundleRoot, name);
    content = mentionSkillCompanions(
      content,
      tree.files,
      await readKnowledgeReferences(bundleRoot, name, tree.files),
    );
    if (!content.endsWith('\n')) content += '\n';
  }
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
 * Create an (empty) directory inside a Skill's folder so the dashboard can
 * scaffold folders before their first file exists. `dirs` in the listing
 * surfaces them even while empty.
 */
export async function createSkillFolder(params: {
  root?: string;
  persona: string;
  name?: string;
  /** Skill-root-relative directory path, e.g. `scripts` or `assets/icons`. */
  dir: string;
}): Promise<{ name: string; dir: string }> {
  const { root } = await resolvePersonaRoot(params.root);
  await ensurePersonaStorage();
  const persona = assertPersonaId(params.persona);
  if (!(await isDirectory(personaDir(persona)))) {
    throw new Error(`Persona "${persona}" does not exist.`);
  }
  const name = assertPersonaName('skill', params.name ?? '');
  if (name === KNOWLEDGE_BASE_SKILL_NAME) {
    throw new Error(
      `Folders in the reserved "${KNOWLEDGE_BASE_SKILL_NAME}" Skill are managed automatically.`,
    );
  }
  if (!params.dir.trim()) {
    throw new Error('Folder name is required.');
  }
  // Same segment rules as skill files: no dotfiles, no traversal, no
  // backslashes. assertSkillFilePath falls back to SKILL.md only for empty
  // input, which the guard above already rejects.
  const dir = assertSkillFilePath(params.dir);
  const absolutePath = resolveInsidePersona(
    persona,
    path.posix.join('skills', name, dir),
  );
  await mkdir(absolutePath, { recursive: true });
  await writeLastRoot(root);
  return { name, dir };
}

/**
 * Remove one file or folder inside a Skill. SKILL.md is required and
 * cannot be deleted this way — delete the Skill itself instead.
 */
export async function deleteSkillPath(params: {
  root?: string;
  persona: string;
  name?: string;
  /** Skill-root-relative file or folder path, e.g. `scripts/run.py`. */
  path: string;
}): Promise<{ name: string; path: string; kind: 'file' | 'dir' }> {
  const { root } = await resolvePersonaRoot(params.root);
  await ensurePersonaStorage();
  const persona = assertPersonaId(params.persona);
  if (!(await isDirectory(personaDir(persona)))) {
    throw new Error(`Persona "${persona}" does not exist.`);
  }
  const name = assertPersonaName('skill', params.name ?? '');
  if (!params.path.trim()) {
    throw new Error('File or folder path is required.');
  }
  const relative = assertSkillFilePath(params.path);
  if (name === KNOWLEDGE_BASE_SKILL_NAME) {
    assertKnowledgeBaseReferencePath(relative);
  }
  if (relative === SKILL_FILE_NAME) {
    throw new Error('SKILL.md is required and cannot be deleted.');
  }
  const skillMdPath = resolveInsidePersona(
    persona,
    path.posix.join('skills', name, SKILL_FILE_NAME),
  );
  if (!(await isFile(skillMdPath))) {
    throw new Error(
      `Skill "${name}" has no ${SKILL_FILE_NAME}; refusing to modify an incomplete Skill.`,
    );
  }
  const absolutePath = resolveInsidePersona(
    persona,
    path.posix.join('skills', name, relative),
  );
  let kind: 'file' | 'dir';
  try {
    const info = await stat(absolutePath);
    kind = info.isDirectory() ? 'dir' : 'file';
  } catch {
    throw new Error(`"${relative}" does not exist.`);
  }
  const currentSkill = await readFile(skillMdPath, 'utf8');
  const bundleRoot = personaDir(persona);
  const tree = await listSkillTree(bundleRoot, name);
  const remainingFiles = tree.files.filter(
    (file) => file !== relative && !file.startsWith(`${relative}/`),
  );
  const nextSkill = mentionSkillCompanions(
    currentSkill,
    remainingFiles,
    await readKnowledgeReferences(bundleRoot, name, remainingFiles),
  );
  if (nextSkill !== currentSkill) {
    await writeFile(
      skillMdPath,
      nextSkill.endsWith('\n') ? nextSkill : `${nextSkill}\n`,
      'utf8',
    );
  }
  try {
    await rm(absolutePath, { recursive: true, force: true });
  } catch (error) {
    if (nextSkill !== currentSkill) {
      await writeFile(skillMdPath, currentSkill, 'utf8');
    }
    throw error;
  }
  await writeLastRoot(root);
  return { name, path: relative, kind };
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
  if (params.kind === 'skill' && name === KNOWLEDGE_BASE_SKILL_NAME) {
    throw new Error(
      `The reserved "${KNOWLEDGE_BASE_SKILL_NAME}" Skill cannot be deleted directly. Delete individual files under ${KNOWLEDGE_BASE_REFERENCE_DIR}/ instead.`,
    );
  }
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
  /**
   * When true, stop after the preflight render and return its `--dry-run`
   * output instead of writing. Deploy always passes `--delete`, so this is the
   * only way to see which existing files it considers orphans before they go.
   */
  dryRun?: boolean;
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
      persona,
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
  ];
  // `--delete` treats every existing output this run did not produce as an
  // orphan and removes it, including whole directories. Under a project root
  // that is recoverable through git; under the user's home it is not, and a
  // dry-run confirmed it takes hand-written ~/.claude/rules/*.md and
  // ~/.claude/skills/<name>/ with it. Global deploy therefore overwrites what
  // it produces and leaves everything else alone.
  if (params?.global) {
    args.push('--global');
  } else {
    args.push('--delete');
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
    if (!preflight.ok || params?.dryRun) return preflight;
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
