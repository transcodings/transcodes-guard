import { basename, join } from 'node:path';

import { encode } from '@toon-format/toon';
import { z } from 'zod/mini';

import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from '../../constants/rulesync-paths.js';
import type { AiDir } from '../../types/ai-dir.js';
import { DirFeatureProcessor } from '../../types/dir-feature-processor.js';
import { skillsProcessorToolTargetTuple } from '../../types/tool-target-tuples.js';
import type { ToolTarget } from '../../types/tool-targets.js';
import { formatError } from '../../utils/error.js';
import {
  assertWritablePathInsideRoot,
  directoryExists,
  findFilesByGlobs,
} from '../../utils/file.js';
import type { Logger } from '../../utils/logger.js';
import { AgentsmdSkill } from './agentsmd-skill.js';
import { AgentsSkillsSkill } from './agentsskills-skill.js';
import { AntigravityCliSkill } from './antigravity-cli-skill.js';
import { AntigravityIdeSkill } from './antigravity-ide-skill.js';
import { AntigravityPluginSkill } from './antigravity-plugin-skill.js';
import { ClaudecodePluginSkill } from './claudecode-plugin-skill.js';
import { ClaudecodeSkill } from './claudecode-skill.js';
import { CodexCliSkill } from './codexcli-skill.js';
import { CursorSkill } from './cursor-skill.js';
import { RulesyncSkill } from './rulesync-skill.js';
import { SimulatedSkill } from './simulated-skill.js';
import { getLocalSkillDirNames } from './skills-utils.js';
import {
  ToolSkill,
  type ToolSkillForDeletionParams,
  type ToolSkillFromDirParams,
  type ToolSkillFromFlatFileParams,
  type ToolSkillFromRulesyncSkillParams,
  type ToolSkillSettablePaths,
  toolSkillImportRoots,
  toolSkillSearchRoots,
} from './tool-skill.js';

/**
 * Factory entry for each tool skill class.
 * Stores the class reference and metadata for a tool.
 */
type ToolSkillFactory = {
  class: {
    isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean;
    fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): ToolSkill;
    fromDir(params: ToolSkillFromDirParams): Promise<ToolSkill>;
    /**
     * Optional loader for tools that also discover flat `<name>.md` skills.
     * Directory-form skills are loaded first and take precedence.
     */
    fromFlatFile?(params: ToolSkillFromFlatFileParams): Promise<ToolSkill>;
    forDeletion(params: ToolSkillForDeletionParams): ToolSkill;
    getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths;
    /**
     * Optional import-only hook for roots that cannot be known statically
     * because they are configured in the tool's own config file (e.g.
     * OpenCode's `skills.paths`). Appended after the declared import roots, so
     * a skill of the same name found in a managed root still wins.
     */
    getConfiguredImportRoots?(params: {
      outputRoot: string;
      global: boolean;
    }): Promise<Array<{ outputRoot: string; relativeDirPath: string }>>;
    /**
     * Optional content-aware ownership filter for tools whose skills directory
     * is shared with another feature's output (e.g. Reasonix subagent profiles
     * living in `.reasonix/skills/` next to regular skills). When present, the
     * processor calls it for every discovered skill directory — for both
     * import and orphan-deletion enumeration — and skips directories it
     * returns false for.
     */
    isDirOwned?(params: {
      outputRoot: string;
      relativeDirPath: string;
      dirName: string;
      /**
       * The rulesync input root, for hooks that decide ownership by
       * cross-referencing `.rulesync/` sources (e.g. Devin command slugs).
       */
      inputRoot: string;
    }): Promise<boolean>;
  };
  meta: {
    /** Whether the tool supports project (workspace-level) skills */
    supportsProject: boolean;
    /** Whether the tool supports simulated skills (embedded in rules) */
    supportsSimulated: boolean;
    /** Whether the tool supports global (user-level) skills */
    supportsGlobal: boolean;
  };
};

/**
 * Supported tool targets for SkillsProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */

export type SkillsProcessorToolTarget =
  (typeof skillsProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const SkillsProcessorToolTargetSchema = z.enum(
  skillsProcessorToolTargetTuple,
);

/**
 * Factory Map mapping tool targets to their skill factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
export const toolSkillFactories = new Map<
  SkillsProcessorToolTarget,
  ToolSkillFactory
>([
  [
    'agentsmd',
    {
      class: AgentsmdSkill,
      meta: {
        supportsProject: true,
        supportsSimulated: true,
        supportsGlobal: false,
      },
    },
  ],
  [
    'agentsskills',
    {
      // The Agent Skills standard defines `~/.agents/skills/` as the personal/global
      // location in addition to project `.agents/skills/`. https://agentskills.io/specification
      class: AgentsSkillsSkill,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
      },
    },
  ],
  [
    'antigravity-cli',
    {
      class: AntigravityCliSkill,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
      },
    },
  ],
  [
    'antigravity-ide',
    {
      class: AntigravityIdeSkill,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
      },
    },
  ],
  [
    'antigravity-plugin',
    {
      class: AntigravityPluginSkill,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: false,
      },
    },
  ],
  [
    'claudecode',
    {
      class: ClaudecodeSkill,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
      },
    },
  ],
  [
    'claudecode-plugin',
    {
      class: ClaudecodePluginSkill,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: false,
      },
    },
  ],
  [
    'codexcli',
    {
      class: CodexCliSkill,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
      },
    },
  ],
  [
    'cursor',
    {
      class: CursorSkill,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
      },
    },
  ],
]);

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: SkillsProcessorToolTarget) => ToolSkillFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolSkillFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

// Derive tool target arrays from factory metadata
const allToolTargetKeys = [...toolSkillFactories.keys()];

const skillsProcessorToolTargetsProject: ToolTarget[] =
  allToolTargetKeys.filter((target) => {
    const factory = toolSkillFactories.get(target);
    return factory?.meta.supportsProject ?? true;
  });

const skillsProcessorToolTargetsSimulated: ToolTarget[] =
  allToolTargetKeys.filter((target) => {
    const factory = toolSkillFactories.get(target);
    return factory?.meta.supportsSimulated ?? false;
  });

export const skillsProcessorToolTargetsGlobal: ToolTarget[] =
  allToolTargetKeys.filter((target) => {
    const factory = toolSkillFactories.get(target);
    return factory?.meta.supportsGlobal ?? false;
  });

export class SkillsProcessor extends DirFeatureProcessor {
  private readonly toolTarget: SkillsProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    outputRoot = process.cwd(),
    inputRoot = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoot?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({
      outputRoot,
      inputRoot,
      dryRun,
      avoidBlockScalars: toolTarget === 'cursor',
      logger,
    });
    const result = SkillsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for SkillsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }

  async convertRulesyncDirsToToolDirs(rulesyncDirs: AiDir[]): Promise<AiDir[]> {
    const rulesyncSkills = rulesyncDirs.filter(
      (dir): dir is RulesyncSkill => dir instanceof RulesyncSkill,
    );

    const factory = this.getFactory(this.toolTarget);

    const toolSkills = rulesyncSkills
      .map((rulesyncSkill) => {
        const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
        const isClaudecodeScheduledTask =
          rulesyncFrontmatter.claudecode?.['scheduled-task'] === true;
        if (isClaudecodeScheduledTask && this.toolTarget !== 'claudecode') {
          return null;
        }
        if (!factory.class.isTargetedByRulesyncSkill(rulesyncSkill)) {
          return null;
        }
        return factory.class.fromRulesyncSkill({
          outputRoot: this.outputRoot,
          rulesyncSkill: rulesyncSkill,
          global: this.global,
          logger: this.logger,
        });
      })
      .filter((skill): skill is ToolSkill => skill !== null);

    return toolSkills;
  }

  async convertToolDirsToRulesyncDirs(toolDirs: AiDir[]): Promise<AiDir[]> {
    const toolSkills = toolDirs.filter(
      (dir): dir is ToolSkill => dir instanceof ToolSkill,
    );

    const rulesyncSkills: RulesyncSkill[] = [];
    for (const toolSkill of toolSkills) {
      // Skip simulated skills as they cannot be converted back
      if (toolSkill instanceof SimulatedSkill) {
        this.logger.debug(
          `Skipping simulated skill conversion: ${toolSkill.getDirPath()}`,
        );
        continue;
      }
      rulesyncSkills.push(toolSkill.toRulesyncSkill());
    }

    return rulesyncSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Load and parse rulesync skill directories from .rulesync/skills/ directory
   * and also from .rulesync/skills/.curated/ for remote skills.
   * Local skills take precedence over curated skills with the same name.
   */
  async loadRulesyncDirs(): Promise<AiDir[]> {
    // Load local skills (directly under .rulesync/skills/)
    const localDirNames = [...(await getLocalSkillDirNames(this.inputRoot))];

    const localSkills = await Promise.all(
      localDirNames.map((dirName) =>
        RulesyncSkill.fromDir({
          outputRoot: this.inputRoot,
          dirName,
          global: this.global,
        }),
      ),
    );

    const localSkillNames = new Set(localDirNames);

    // Load curated (remote) skills from .curated/ subdirectory
    const curatedDirPath = join(
      this.inputRoot,
      RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
    );
    let curatedSkills: RulesyncSkill[] = [];

    if (await directoryExists(curatedDirPath)) {
      const curatedDirPaths = await findFilesByGlobs(
        join(curatedDirPath, '*'),
        { type: 'dir' },
      );
      const curatedDirNames = curatedDirPaths.map((path) => basename(path));

      // Filter out curated skills that conflict with local skills (local wins)
      const nonConflicting = curatedDirNames.filter((name) => {
        if (localSkillNames.has(name)) {
          this.logger.debug(
            `Skipping curated skill "${name}": local skill takes precedence.`,
          );
          return false;
        }
        return true;
      });

      const curatedRelativeDirPath = RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH;
      curatedSkills = await Promise.all(
        nonConflicting.map((dirName) =>
          RulesyncSkill.fromDir({
            outputRoot: this.inputRoot,
            relativeDirPath: curatedRelativeDirPath,
            dirName,
            global: this.global,
          }),
        ),
      );
    }

    const allSkills = [...localSkills, ...curatedSkills];
    this.logger.debug(
      `Successfully loaded ${allSkills.length} rulesync skills (${localSkills.length} local, ${curatedSkills.length} curated)`,
    );
    return allSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Load tool-specific skill configurations and parse them into ToolSkill instances
   */
  async loadToolDirs(): Promise<AiDir[]> {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });
    const configuredRoots = factory.class.getConfiguredImportRoots
      ? await factory.class.getConfiguredImportRoots({
          outputRoot: this.outputRoot,
          global: this.global,
        })
      : [];
    const configuredRootPaths = new Set(
      configuredRoots.map((root) => root.relativeDirPath),
    );
    const roots = [...toolSkillImportRoots(paths), ...configuredRoots];

    const seenSkillNames = new Set<string>();
    const toolSkills: ToolSkill[] = [];
    for (const root of roots) {
      const rootOutputRoot =
        typeof root === 'string' ? this.outputRoot : root.outputRoot;
      const relativeDirPath =
        typeof root === 'string' ? root : root.relativeDirPath;
      const isConfiguredRoot = configuredRootPaths.has(relativeDirPath);
      const skillsDirPath = join(rootOutputRoot, relativeDirPath);
      if (!(await directoryExists(skillsDirPath))) {
        continue;
      }
      const dirPaths = await findFilesByGlobs(join(skillsDirPath, '*'), {
        type: 'dir',
      });
      const ownedDirNames: string[] = [];
      for (const dirPath of dirPaths) {
        const dirName = basename(dirPath);
        // Directories owned by another feature (see the `isDirOwned` factory
        // hook) are skipped so e.g. a Reasonix subagent profile is not
        // imported as a regular skill.
        if (
          factory.class.isDirOwned &&
          !(await factory.class.isDirOwned({
            outputRoot: rootOutputRoot,
            relativeDirPath,
            dirName,
            inputRoot: this.inputRoot,
          }))
        ) {
          continue;
        }
        ownedDirNames.push(dirName);
      }

      const directorySkills = (
        await Promise.all(
          ownedDirNames.map(async (dirName) => {
            try {
              return await factory.class.fromDir({
                outputRoot: rootOutputRoot,
                relativeDirPath,
                dirName,
                global: this.global,
              });
            } catch (error) {
              if (!isConfiguredRoot) {
                throw error;
              }
              // A root the tool's own config points at is arbitrary user
              // territory — a folder of skills may sit next to folders that are
              // not skills at all. One of those must not take the whole import,
              // and every feature after it, down.
              this.logger.warn(
                `Skipping ${join(relativeDirPath, dirName)}: ${formatError(error)}`,
              );
              return null;
            }
          }),
        )
      ).filter((skill) => skill !== null);
      for (const skill of directorySkills) {
        const skillName = skill.getImportIdentity();
        if (seenSkillNames.has(skillName)) {
          continue;
        }
        seenSkillNames.add(skillName);
        toolSkills.push(skill);
      }

      if (!factory.class.fromFlatFile) {
        continue;
      }
      const fromFlatFile = factory.class.fromFlatFile;
      const directoryStems = new Set(ownedDirNames);
      const flatFilePaths = (
        await findFilesByGlobs(join(skillsDirPath, '*.md'), {
          type: 'file',
        })
      ).filter((filePath) => !directoryStems.has(basename(filePath, '.md')));
      const flatSkills = await Promise.all(
        flatFilePaths.map((filePath) =>
          fromFlatFile({
            outputRoot: rootOutputRoot,
            relativeDirPath,
            relativeFilePath: basename(filePath),
            global: this.global,
          }),
        ),
      );
      for (const skill of flatSkills) {
        const skillName = skill.getImportIdentity();
        if (seenSkillNames.has(skillName)) {
          continue;
        }
        seenSkillNames.add(skillName);
        toolSkills.push(skill);
      }
    }

    this.logger.debug(
      `Successfully loaded ${toolSkills.length} skills from ${roots.length} root(s)`,
    );
    return toolSkills;
  }

  async loadToolDirsToDelete(): Promise<AiDir[]> {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });
    const roots = toolSkillSearchRoots(paths);

    const toolSkills: AiDir[] = [];
    for (const root of roots) {
      const skillsDirPath = join(this.outputRoot, root);
      if (!(await directoryExists(skillsDirPath))) {
        continue;
      }
      await assertWritablePathInsideRoot({
        rootPath: this.outputRoot,
        targetPath: skillsDirPath,
      });
      const dirPaths = await findFilesByGlobs(join(skillsDirPath, '*'), {
        type: 'dir',
        followSymbolicLinks: false,
      });
      for (const dirPath of dirPaths) {
        await assertWritablePathInsideRoot({
          rootPath: skillsDirPath,
          targetPath: dirPath,
        });
        const dirName = basename(dirPath);
        // Directories owned by another feature (see the `isDirOwned` factory
        // hook) must never be deleted as orphan skills — e.g. a Reasonix
        // subagent profile generated into the shared `.reasonix/skills/`, or
        // a Devin command emitted onto the skills surface.
        if (
          factory.class.isDirOwned &&
          !(await factory.class.isDirOwned({
            outputRoot: this.outputRoot,
            relativeDirPath: root,
            dirName,
            inputRoot: this.inputRoot,
          }))
        ) {
          continue;
        }
        const toolSkill = factory.class.forDeletion({
          outputRoot: this.outputRoot,
          relativeDirPath: root,
          dirName,
          global: this.global,
        });
        toolSkills.push(toolSkill);
      }
    }

    this.logger.debug(
      `Successfully loaded ${toolSkills.length} skills for deletion under ${roots.join(', ')}`,
    );
    return toolSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    global = false,
    includeSimulated = false,
  }: {
    global?: boolean;
    includeSimulated?: boolean;
  } = {}): ToolTarget[] {
    if (global) {
      return skillsProcessorToolTargetsGlobal;
    }
    const projectTargets = skillsProcessorToolTargetsProject;
    if (!includeSimulated) {
      return projectTargets.filter(
        (target) => !skillsProcessorToolTargetsSimulated.includes(target),
      );
    }
    return projectTargets;
  }

  /**
   * Return the simulated tool targets
   */
  static getToolTargetsSimulated(): ToolTarget[] {
    return skillsProcessorToolTargetsSimulated;
  }

  /**
   * Convention section describing simulated skills, embedded into a tool's root
   * rule (e.g. AGENTS.md) by the rules feature. Returns an empty string when there
   * are no skills to list.
   */
  static getSimulatedConventionSection({
    skillList,
  }: {
    skillList?: Array<{ name: string; description: string; path: string }>;
  }): string {
    if (!skillList || skillList.length === 0) {
      return '';
    }

    const skillListWithAtPrefix = skillList.map((skill) => ({
      ...skill,
      path: `@${skill.path}`,
    }));
    const toonContent = encode({ skillList: skillListWithAtPrefix });

    return `## Simulated Skills

Simulated skills are specialized capabilities that can be invoked to handle specific types of tasks. When you determine that a skill would be helpful for the current task, read the corresponding SKILL.md file and execute its instructions.

${toonContent}`;
  }

  /**
   * Return the tool targets that this processor supports in global mode
   */
  static getToolTargetsGlobal(): ToolTarget[] {
    return skillsProcessorToolTargetsGlobal;
  }

  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid SkillsProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target: ToolTarget): ToolSkillFactory | undefined {
    // Validate that target is supported
    const result = SkillsProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return undefined;
    }
    return toolSkillFactories.get(result.data);
  }
}
