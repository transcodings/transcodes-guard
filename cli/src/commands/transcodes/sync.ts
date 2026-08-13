/**
 * `transcodes sync` — project rules/skills sync (first-class CLI command).
 *
 * Same style as login.ts / install.ts: parse argv here, call the engine under
 * ../sync/, write to stdout/stderr. No nested commander program.
 */

import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { ConfigResolver } from '../sync/config/config-resolver.js';
import { SKILL_FILE_NAME } from '../sync/constants/general.js';
import {
  RULESYNC_AGENTS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from '../sync/constants/rulesync-paths.js';
import {
  coerceSkillName,
  createFeatureScaffold,
  parseScaffoldFeatureKeyword,
  parseSkillOptionalDirs,
  parseSkillScriptLanguage,
  SKILL_OPTIONAL_DIRS,
  type SkillScriptLanguage,
} from '../sync/lib/feature-scaffold.js';
import { checkRulesyncDirExists, generate } from '../sync/lib/generate.js';
import { init } from '../sync/lib/init.js';
import {
  type RulesyncFeatures,
  RulesyncFeaturesSchema,
} from '../sync/types/features.js';
import {
  type RulesyncTargets,
  RulesyncTargetsSchema,
} from '../sync/types/tool-targets.js';
import {
  assertWritablePathInsideRoot,
  ensureDir,
  fileExists,
  writeFileContent,
} from '../sync/utils/file.js';
import { ConsoleLogger } from '../sync/utils/logger.js';
import { parseCommaSeparatedList } from '../sync/utils/parse-comma-separated-list.js';
import { calculateTotalCount } from '../sync/utils/result.js';
import { detectSyncTargets } from './host-apps.js';

function fail(message: string): never {
  process.stderr.write(`transcodes: ${message}\n`);
  process.exit(1);
}

function usage(): string {
  return `Usage:
  transcodes sync init
  transcodes sync generate [options]
  transcodes sync add <rule|skill> --name <name> [--force]
                      [--folder scripts,references,assets | --full]
                      [--lang python|node|bash]  (skill only; SKILL.md is
                      always created, directories are optional. --lang adds a
                      starter script under scripts/)

generate options:
  -t, --targets <tools>     e.g. claudecode,cursor,agentsmd or *
                            (omit to auto-detect installed AI apps + agentsmd)
  -f, --features <list>     rules,skills or *
  --simulate-skills         Emit skills for tools without native support
  --delete                  Clear generated outputs before writing
  -o, --output-roots <dirs> Comma-separated output roots
  -c, --config <path>       Config file path
  --input-root <path>       Parent of .transcodes/
  --dry-run                 Preview without writing
  --check                   Exit 1 if out of date
  -V, --verbose | -s, --silent
`;
}

function takeFlagValue(args: string[], i: number, flag: string): string {
  const value = args[i + 1];
  if (!value || value.startsWith('-')) {
    fail(`missing value for ${flag}`);
  }
  return value;
}

async function cmdInit(args: string[]): Promise<void> {
  let verbose = false;
  let silent = false;
  for (const arg of args) {
    if (arg === '-V' || arg === '--verbose') verbose = true;
    else if (arg === '-s' || arg === '--silent') silent = true;
    else fail(`unknown flag "${arg}".\n${usage()}`);
  }

  const logger = new ConsoleLogger({ verbose, silent });
  await ensureDir(RULESYNC_RELATIVE_DIR_PATH);
  const result = await init();

  for (const file of result.sampleFiles) {
    if (file.created) logger.success(`Created ${file.path}`);
    else logger.info(`Skipped ${file.path} (already exists)`);
  }
  if (result.configFile.created) {
    logger.success(`Created ${result.configFile.path}`);
  } else {
    logger.info(`Skipped ${result.configFile.path} (already exists)`);
  }

  logger.success('Initialized .transcodes/');
  logger.info('Next steps:');
  logger.info(
    `1. Edit ${RULESYNC_AGENTS_RELATIVE_FILE_PATH}, ${RULESYNC_RULES_RELATIVE_DIR_PATH}/*.md and ${RULESYNC_SKILLS_RELATIVE_DIR_PATH}/*/${SKILL_FILE_NAME}`,
  );
  logger.info('2. Run `transcodes sync generate`');
}

function parseTargetsFlag(raw: string): RulesyncTargets {
  const parsed = RulesyncTargetsSchema.safeParse(parseCommaSeparatedList(raw));
  if (!parsed.success) {
    fail(`invalid --targets: ${parsed.error.message}`);
  }
  return parsed.data;
}

function parseFeaturesFlag(raw: string): RulesyncFeatures {
  const parsed = RulesyncFeaturesSchema.safeParse(parseCommaSeparatedList(raw));
  if (!parsed.success) {
    fail(`invalid --features: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function cmdGenerate(args: string[]): Promise<void> {
  let targets: RulesyncTargets | undefined;
  let targetsFromCli = false;
  let features: RulesyncFeatures | undefined;
  let outputRoots: string[] | undefined;
  let configPath: string | undefined;
  let inputRoot: string | undefined;
  let del = false;
  let simulateSkills = false;
  let dryRun = false;
  let check = false;
  let global = false;
  let verbose = false;
  let silent = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-t' || arg === '--targets') {
      targets = parseTargetsFlag(takeFlagValue(args, i++, arg));
      targetsFromCli = true;
    } else if (arg === '-f' || arg === '--features') {
      features = parseFeaturesFlag(takeFlagValue(args, i++, arg));
    } else if (arg === '-o' || arg === '--output-roots') {
      outputRoots = parseCommaSeparatedList(takeFlagValue(args, i++, arg));
    } else if (arg === '-c' || arg === '--config') {
      configPath = takeFlagValue(args, i++, arg);
    } else if (arg === '--input-root') {
      inputRoot = takeFlagValue(args, i++, arg);
    } else if (arg === '--delete') del = true;
    else if (arg === '--simulate-skills') simulateSkills = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--check') check = true;
    else if (arg === '-g' || arg === '--global') global = true;
    else if (arg === '-V' || arg === '--verbose') verbose = true;
    else if (arg === '-s' || arg === '--silent') silent = true;
    else if (arg === '-h' || arg === '--help') {
      process.stdout.write(usage());
      return;
    } else fail(`unknown flag "${arg}".\n${usage()}`);
  }

  const logger = new ConsoleLogger({ verbose, silent });

  // -t set → only those targets. Omitted → detect installed AI apps (+ agentsmd).
  if (!targetsFromCli) {
    targets = detectSyncTargets();
    logger.info(`Auto-detected targets: ${targets.join(', ')}`);
    if (targets.length === 1 && targets[0] === 'agentsmd') {
      logger.info(
        'No Claude / Cursor / Codex / Antigravity app detected on this machine; generating agentsmd only. Pass -t to override.',
      );
    }
  }

  const config = await ConfigResolver.resolve(
    {
      targets,
      features,
      outputRoots,
      configPath,
      inputRoot,
      delete: del,
      simulateSkills,
      dryRun,
      check,
      global,
      verbose,
      silent,
    },
    { logger },
  );

  if (!(await checkRulesyncDirExists({ inputRoot: config.getInputRoot() }))) {
    fail(".transcodes directory not found. Run 'transcodes sync init' first.");
  }

  const result = await generate({ config, logger });
  const total = calculateTotalCount(result);
  const isPreview = config.isPreviewMode();

  if (result.skillsCount > 0) {
    logger.success(
      `${isPreview ? 'Would write' : 'Written'} ${result.skillsCount} skill(s)`,
    );
    for (const p of result.skillsPaths) logger.info(`    ${p}`);
  }
  if (result.rulesCount > 0) {
    logger.success(
      `${isPreview ? 'Would write' : 'Written'} ${result.rulesCount} rule(s)`,
    );
    for (const p of result.rulesPaths) logger.info(`    ${p}`);
  }

  if (config.getCheck()) {
    if (result.hasDiff) {
      fail("Files are not up to date. Run 'transcodes sync generate'.");
    }
    logger.success('All files are up to date.');
    return;
  }

  if (total === 0) {
    logger.info(
      `All files are up to date (${config.getFeatures().join(', ')})`,
    );
    return;
  }

  const parts = [
    result.rulesCount > 0 ? `${result.rulesCount} rules` : '',
    result.skillsCount > 0 ? `${result.skillsCount} skills` : '',
  ].filter(Boolean);
  logger.success(
    `${isPreview ? 'Would write' : 'Written'} ${total} file(s) (${parts.join(' + ')})`,
  );
}

async function promptOverwrite(relativeFilePath: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      `Refusing to overwrite ${relativeFilePath} non-interactively. Use --force.`,
    );
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      `Overwrite ${relativeFilePath}? [y/N] `,
    );
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function cmdAdd(args: string[]): Promise<void> {
  const source = args[0];
  if (!source || source.startsWith('-')) {
    fail(
      'missing feature. Usage: transcodes sync add <rule|skill> --name <name>',
    );
  }

  let name: string | undefined;
  let force = false;
  let verbose = false;
  let silent = false;
  let withDirs: string[] = [];
  let full = false;
  let lang: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--name') name = takeFlagValue(args, i++, arg);
    else if (arg === '--folder')
      withDirs = withDirs.concat(
        parseCommaSeparatedList(takeFlagValue(args, i++, arg)),
      );
    else if (arg === '--full') full = true;
    else if (arg === '--lang') lang = takeFlagValue(args, i++, arg);
    else if (arg === '-f' || arg === '--force') force = true;
    else if (arg === '-V' || arg === '--verbose') verbose = true;
    else if (arg === '-s' || arg === '--silent') silent = true;
    else fail(`unknown flag "${arg}".\n${usage()}`);
  }

  const feature = parseScaffoldFeatureKeyword(source);
  if (!feature) {
    fail(`unknown feature "${source}". Use rule or skill.`);
  }

  if (feature !== 'skill' && (full || withDirs.length > 0 || lang)) {
    fail('--folder, --full, and --lang are only valid for skills.');
  }

  // SKILL.md is mandatory; scripts/references/assets are opt-in.
  let include: ReturnType<typeof parseSkillOptionalDirs> = [];
  let scriptLanguage: SkillScriptLanguage | undefined;
  try {
    include = full
      ? [...SKILL_OPTIONAL_DIRS]
      : parseSkillOptionalDirs(withDirs);
    if (lang !== undefined) scriptLanguage = parseSkillScriptLanguage(lang);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  // The frontmatter `name` must match the folder, so the folder name has to
  // be spec-shaped already. Suggest the coerced form instead of silently
  // renaming what the user typed.
  if (feature === 'skill' && name !== undefined) {
    const coerced = coerceSkillName(name);
    if (!coerced) {
      fail(
        `invalid skill name "${name}". Use lowercase letters, numbers, and hyphens.`,
      );
    }
    if (coerced !== name.trim().replace(/\.md$/i, '')) {
      fail(
        `skill names use lowercase letters, numbers, and single hyphens. Try --name ${coerced}`,
      );
    }
  }

  const logger = new ConsoleLogger({ verbose, silent });
  const scaffold = createFeatureScaffold({
    feature,
    name,
    include,
    scriptLanguage,
  });
  const projectRoot = process.cwd();
  let relativeFilePath = scaffold.relativeFilePath;
  for (const candidate of scaffold.candidateRelativeFilePaths) {
    if (await fileExists(join(projectRoot, candidate))) {
      relativeFilePath = candidate;
      break;
    }
  }
  const targetPath = join(projectRoot, relativeFilePath);
  await assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath });

  if ((await fileExists(targetPath)) && !force) {
    const ok = await promptOverwrite(relativeFilePath);
    if (!ok) {
      logger.info(`Kept ${relativeFilePath} unchanged.`);
      return;
    }
  }

  await ensureDir(dirname(targetPath));
  await writeFileContent(targetPath, scaffold.content);
  logger.success(`Created ${relativeFilePath}`);

  for (const extra of scaffold.extraFiles) {
    const extraPath = join(projectRoot, extra.relativeFilePath);
    await assertWritablePathInsideRoot({
      rootPath: projectRoot,
      targetPath: extraPath,
    });
    // --force covers the whole bundle. Refreshing SKILL.md while leaving the
    // companions on their old templates is the one outcome nobody asked for.
    // Unlike the main file this never prompts — a prompt per companion would
    // be tedious, and without --force the existing file simply stays.
    if ((await fileExists(extraPath)) && !force) {
      logger.info(`Kept ${extra.relativeFilePath} unchanged.`);
      continue;
    }
    await ensureDir(dirname(extraPath));
    await writeFileContent(extraPath, extra.content);
    logger.success(`Created ${extra.relativeFilePath}`);
  }
}

/** Entry for `transcodes sync …` (args after `sync`). */
export async function cmdSync(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'init':
      await cmdInit(rest);
      break;
    case 'generate':
      await cmdGenerate(rest);
      break;
    case 'add':
      await cmdAdd(rest);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      process.stdout.write(usage());
      if (sub === undefined) process.exit(1);
      break;
    default:
      fail(`unknown sync command "${sub}".\n${usage()}`);
  }
}
