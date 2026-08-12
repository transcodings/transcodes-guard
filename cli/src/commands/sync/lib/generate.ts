/**
 * Vendored from rulesync (https://github.com/dyoshikawa/rulesync), MIT,
 * Copyright (c) 2024 dyoshikawa. Everything under `cli/src/commands/sync/` is a
 * copy of upstream v16.5.0 adapted for this project, not an npm dependency —
 * see NOTICE.md at the repo root for the license text and the change list.
 *
 * Upstream changes are not merged back in, but keep edits here minimal anyway:
 * the smaller the diff from upstream, the easier it stays to compare against.
 */
import { join } from 'node:path';

import { intersection } from 'es-toolkit';

import type { Config } from '../config/config.js';
import { AGENTSMD_RULE_FILE_NAME } from '../constants/agentsmd-paths.js';
import { RULESYNC_RELATIVE_DIR_PATH } from '../constants/rulesync-paths.js';
import { RulesProcessor } from '../features/rules/rules-processor.js';
import { RulesyncSkill } from '../features/skills/rulesync-skill.js';
import { SkillsProcessor } from '../features/skills/skills-processor.js';
import type { AiDir } from '../types/ai-dir.js';
import type { AiFile } from '../types/ai-file.js';
import type { DirFeatureProcessor } from '../types/dir-feature-processor.js';
import type { FeatureProcessor } from '../types/feature-processor.js';
import type { Feature } from '../types/features.js';
import { getProcessorRegistryEntry } from '../types/processor-registry.js';
import type { RulesyncFile } from '../types/rulesync-file.js';
import type { ToolTarget } from '../types/tool-targets.js';
import { fileExists, toPosixPath } from '../utils/file.js';
import type { Logger } from '../utils/logger.js';
import { assertPluginRootSafe } from '../utils/plugin-root.js';
import type { FeatureGenerateResult } from '../utils/result.js';
import { resolveToolOutputRoot } from '../utils/tool-output-root.js';

export type GenerateResult = {
  rulesCount: number;
  rulesPaths: string[];
  skillsCount: number;
  skillsPaths: string[];
  skills: RulesyncSkill[];
  hasDiff: boolean;
};

async function processFeatureGeneration<T extends AiFile>(params: {
  config: Config;
  processor: FeatureProcessor;
  toolFiles: T[];
  skipFilePaths?: Set<string>;
}): Promise<FeatureGenerateResult> {
  const { config, processor, toolFiles, skipFilePaths } = params;

  const filesToCheck =
    skipFilePaths && skipFilePaths.size > 0
      ? toolFiles.filter((f) => !skipFilePaths.has(f.getRelativePathFromCwd()))
      : toolFiles;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const writeResult = await processor.writeAiFiles(filesToCheck);
  totalCount += writeResult.count;
  allPaths.push(...writeResult.paths);
  if (writeResult.count > 0) hasDiff = true;

  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({
      forDeletion: true,
    });

    const orphanCount = await processor.removeOrphanAiFiles(
      existingToolFiles,
      toolFiles,
    );
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function processDirFeatureGeneration(params: {
  config: Config;
  processor: DirFeatureProcessor;
  toolDirs: AiDir[];
}): Promise<FeatureGenerateResult> {
  const { config, processor, toolDirs } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const writeResult = await processor.writeAiDirs(toolDirs);
  totalCount += writeResult.count;
  allPaths.push(...writeResult.paths);
  if (writeResult.count > 0) hasDiff = true;

  if (config.getDelete()) {
    const existingToolDirs = await processor.loadToolDirsToDelete();

    const orphanCount = await processor.removeOrphanAiDirs(
      existingToolDirs,
      toolDirs,
    );
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function processEmptyFeatureGeneration(params: {
  config: Config;
  processor: FeatureProcessor;
  skipFilePaths?: Set<string>;
}): Promise<FeatureGenerateResult> {
  const { config, processor, skipFilePaths } = params;

  const totalCount = 0;
  let hasDiff = false;

  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({
      forDeletion: true,
    });

    const filesToDelete =
      skipFilePaths && skipFilePaths.size > 0
        ? existingToolFiles.filter(
            (f) => !skipFilePaths.has(f.getRelativePathFromCwd()),
          )
        : existingToolFiles;

    const orphanCount = await processor.removeOrphanAiFiles(filesToDelete, []);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, paths: [], hasDiff };
}

async function processFeatureWithRulesyncFiles(params: {
  config: Config;
  processor: FeatureProcessor;
  rulesyncFiles: RulesyncFile[];
  skipFilePaths?: Set<string>;
}): Promise<FeatureGenerateResult> {
  const { config, processor, rulesyncFiles, skipFilePaths } = params;
  if (rulesyncFiles.length === 0) {
    return processEmptyFeatureGeneration({ config, processor, skipFilePaths });
  }
  const toolFiles =
    await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
  return processFeatureGeneration({
    config,
    processor,
    toolFiles,
    skipFilePaths,
  });
}

const SIMULATE_OPTION_MAP: Partial<Record<Feature, string>> = {
  skills: '--simulate-skills',
};

function warnUnsupportedTargets(params: {
  config: Config;
  supportedTargets: ToolTarget[];
  simulatedTargets?: ToolTarget[];
  featureName: Feature;
  logger: Logger;
}): void {
  const {
    config,
    supportedTargets,
    simulatedTargets = [],
    featureName,
    logger,
  } = params;
  let oppositeScopeTargets: ToolTarget[] = [];
  try {
    oppositeScopeTargets = getProcessorRegistryEntry(
      featureName,
    ).processor.getToolTargets({
      global: !config.getGlobal(),
    });
  } catch {
    oppositeScopeTargets = [];
  }
  for (const target of config.getTargets()) {
    if (
      !supportedTargets.includes(target) &&
      config.getFeatures(target).includes(featureName)
    ) {
      const simulateOption = SIMULATE_OPTION_MAP[featureName];
      if (simulateOption && simulatedTargets.includes(target)) {
        logger.warn(
          `Target '${target}' only supports simulated '${featureName}'. Use '${simulateOption}' to enable it. Skipping.`,
        );
      } else if (oppositeScopeTargets.includes(target)) {
        const supportedScope = config.getGlobal() ? 'project' : 'global';
        const retry = config.getGlobal()
          ? "without '--global'"
          : "with '--global'";
        logger.warn(
          `Target '${target}' supports the feature '${featureName}' only in ${supportedScope} scope. Re-run ${retry}. Skipping.`,
        );
      } else {
        logger.warn(
          `Target '${target}' does not support the feature '${featureName}'. Skipping.`,
        );
      }
    }
  }
}

/** Check if `.transcodes` directory exists under the input root. */
export async function checkRulesyncDirExists(params: {
  inputRoot: string;
}): Promise<boolean> {
  return fileExists(join(params.inputRoot, RULESYNC_RELATIVE_DIR_PATH));
}

/**
 * Generate rules + skills for the slim Transcodes fork targets.
 * @throws Error if generation fails
 */
export async function generate(params: {
  config: Config;
  logger: Logger;
}): Promise<GenerateResult> {
  const { config, logger } = params;

  for (const toolTarget of config.getTargets()) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      await assertPluginRootSafe({ toolTarget, outputRoot });
    }
  }

  // Skills first so root rules can embed skill references when needed.
  const skillsResult = await generateSkillsCore({ config, logger });
  const rulesResult = await generateRulesCore({
    config,
    logger,
    skills: skillsResult.skills,
  });

  return {
    rulesCount: rulesResult.count,
    rulesPaths: rulesResult.paths,
    skillsCount: skillsResult.count,
    skillsPaths: skillsResult.paths,
    skills: skillsResult.skills,
    hasDiff: rulesResult.hasDiff || skillsResult.hasDiff,
  };
}

function computeRootFileOwnership(params: {
  targets: ToolTarget[];
  global: boolean;
}): Map<string, ToolTarget> {
  const ownerByPath = new Map<string, ToolTarget>();
  const register = (
    relativeDirPath: string,
    relativeFilePath: string,
    target: ToolTarget,
  ): void => {
    ownerByPath.set(
      toPosixPath(join(relativeDirPath, relativeFilePath)),
      target,
    );
  };
  for (const target of params.targets) {
    const factory = RulesProcessor.getFactory(target);
    if (!factory) continue;
    const paths = factory.class.getSettablePaths({ global: params.global });
    if ('root' in paths && paths.root) {
      register(paths.root.relativeDirPath, paths.root.relativeFilePath, target);
    }
    if ('alternativeRoots' in paths && paths.alternativeRoots) {
      for (const alt of paths.alternativeRoots) {
        register(alt.relativeDirPath, alt.relativeFilePath, target);
      }
    }
    if (!params.global && factory.class.getRootMirror) {
      register('.', AGENTSMD_RULE_FILE_NAME, target);
    }
  }
  return ownerByPath;
}

async function generateRulesCore(params: {
  config: Config;
  logger: Logger;
  skills?: RulesyncSkill[];
}): Promise<FeatureGenerateResult> {
  const { config, logger, skills } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedTargets = RulesProcessor.getToolTargets({
    global: config.getGlobal(),
  });
  const toolTargets = intersection(config.getTargets(), supportedTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets,
    featureName: 'rules',
    logger,
  });

  const isCheck = config.getCheck();
  const rootFileOwner = isCheck
    ? computeRootFileOwnership({
        targets: config.getConfigFileTargets(),
        global: config.getGlobal(),
      })
    : new Map<string, ToolTarget>();

  for (const toolTarget of toolTargets) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      if (!config.getFeatures(toolTarget).includes('rules')) {
        continue;
      }

      const processor = new RulesProcessor({
        outputRoot: resolveToolOutputRoot({
          outputRoot,
          toolTarget,
          global: config.getGlobal(),
        }),
        inputRoot: config.getInputRoot(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        simulateSkills: config.getSimulateSkills(),
        skills: skills,
        featureOptions: config.getFeatureOptions(toolTarget, 'rules'),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();

      const skipFilePaths = new Set<string>();
      if (isCheck) {
        for (const [rootPath, owner] of rootFileOwner) {
          if (owner !== toolTarget) {
            skipFilePaths.add(rootPath);
          }
        }
      }

      const result = await processFeatureWithRulesyncFiles({
        config,
        processor,
        rulesyncFiles,
        skipFilePaths: skipFilePaths.size > 0 ? skipFilePaths : undefined,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateSkillsCore(params: {
  config: Config;
  logger: Logger;
}): Promise<FeatureGenerateResult & { skills: RulesyncSkill[] }> {
  const { config, logger } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;
  const allSkills: RulesyncSkill[] = [];

  const supportedSkillsTargets = SkillsProcessor.getToolTargets({
    global: config.getGlobal(),
    includeSimulated: config.getSimulateSkills(),
  });
  const toolTargets = intersection(config.getTargets(), supportedSkillsTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedSkillsTargets,
    simulatedTargets: SkillsProcessor.getToolTargetsSimulated(),
    featureName: 'skills',
    logger,
  });

  for (const toolTarget of toolTargets) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      if (!config.getFeatures(toolTarget).includes('skills')) {
        continue;
      }

      const processor = new SkillsProcessor({
        outputRoot: resolveToolOutputRoot({
          outputRoot,
          toolTarget,
          global: config.getGlobal(),
        }),
        inputRoot: config.getInputRoot(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncDirs = await processor.loadRulesyncDirs();

      for (const rulesyncDir of rulesyncDirs) {
        if (rulesyncDir instanceof RulesyncSkill) {
          allSkills.push(rulesyncDir);
        }
      }

      const toolDirs =
        await processor.convertRulesyncDirsToToolDirs(rulesyncDirs);

      const result = await processDirFeatureGeneration({
        config,
        processor,
        toolDirs,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, skills: allSkills, hasDiff };
}
