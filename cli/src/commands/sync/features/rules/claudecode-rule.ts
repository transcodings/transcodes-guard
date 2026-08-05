import { join } from 'node:path';

import { z } from 'zod/mini';

import { AGENTSMD_RULE_FILE_NAME } from '../../constants/agentsmd-paths.js';
import {
  CLAUDECODE_DIR,
  CLAUDECODE_RULE_FILE_NAME,
  CLAUDECODE_RULES_DIR_NAME,
} from '../../constants/claudecode-paths.js';
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from '../../constants/rulesync-paths.js';
import type { ValidationResult } from '../../types/ai-file.js';
import { formatError } from '../../utils/error.js';
import { readFileContent } from '../../utils/file.js';
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from '../../utils/frontmatter.js';
import { AgentsMdRule } from './agentsmd-rule.js';
import { RulesyncRule, type RulesyncRuleFrontmatter } from './rulesync-rule.js';
import {
  buildToolPath,
  ToolRule,
  type ToolRuleForDeletionParams,
  type ToolRuleFromFileParams,
  type ToolRuleFromRulesyncRuleParams,
  type ToolRuleParams,
  type ToolRuleSettablePaths,
  type ToolRuleSettablePathsGlobal,
} from './tool-rule.js';

/** Claude Code import directive — keep AGENTS.md as the shared instruction body. */
const CLAUDECODE_AGENTS_IMPORT = `@${AGENTSMD_RULE_FILE_NAME}\n`;

/**
 * Frontmatter schema for Claude Code modular rules
 * @see https://code.claude.com/docs/en/memory#modular-rules-with-clauderules
 */
const ClaudecodeRuleFrontmatterSchema = z.object({
  paths: z.optional(z.array(z.string())),
});

export type ClaudecodeRuleFrontmatter = z.infer<
  typeof ClaudecodeRuleFrontmatterSchema
>;

export type ClaudecodeRuleParams = Omit<ToolRuleParams, 'fileContent'> & {
  frontmatter: ClaudecodeRuleFrontmatter;
  body: string;
  /** Full Instruction body written to AGENTS.md when root CLAUDE.md only imports it. */
  agentsBody?: string;
};

export type ClaudecodeRuleSettablePaths = Omit<
  ToolRuleSettablePaths,
  'root'
> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  alternativeRoots?: Array<{
    relativeDirPath: string;
    relativeFilePath: string;
  }>;
  nonRoot: {
    relativeDirPath: string;
  };
};

export type ClaudecodeRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for Claude Code AI assistant (Modular Rules)
 *
 * Generates modular rule files based on rulesync rule content.
 * Supports the Claude Code modular rules system.
 *
 * Modular rules format:
 * - {project}/AGENTS.md (shared Instruction body)
 * - {project}/CLAUDE.md → `@AGENTS.md` import (root: true)
 * - {project}/.claude/rules/*.md (root: false; no path/glob applicability)
 *
 * @see https://code.claude.com/docs/en/memory#modular-rules-with-clauderules
 * @see https://code.claude.com/docs/en/memory#agents-md
 */
export class ClaudecodeRule extends ToolRule {
  private readonly frontmatter: ClaudecodeRuleFrontmatter;
  private readonly body: string;
  private readonly agentsBody: string;

  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ClaudecodeRuleSettablePaths | ClaudecodeRuleSettablePathsGlobal {
    if (global) {
      // Claude Code reads user-scoped modular rules from `~/.claude/rules/*.md`
      // (https://code.claude.com/docs/en/memory — "User-level rules"), so global
      // non-root rules are generated there instead of being dropped.
      return {
        root: {
          relativeDirPath: buildToolPath(CLAUDECODE_DIR, '.', excludeToolDir),
          relativeFilePath: CLAUDECODE_RULE_FILE_NAME,
        },
        nonRoot: {
          relativeDirPath: buildToolPath(
            CLAUDECODE_DIR,
            CLAUDECODE_RULES_DIR_NAME,
            excludeToolDir,
          ),
        },
      };
    }
    return {
      root: {
        relativeDirPath: '.',
        relativeFilePath: CLAUDECODE_RULE_FILE_NAME,
      },
      alternativeRoots: [
        {
          relativeDirPath: CLAUDECODE_DIR,
          relativeFilePath: CLAUDECODE_RULE_FILE_NAME,
        },
      ],
      nonRoot: {
        relativeDirPath: buildToolPath(
          CLAUDECODE_DIR,
          CLAUDECODE_RULES_DIR_NAME,
          excludeToolDir,
        ),
      },
    };
  }

  constructor({
    frontmatter,
    body,
    agentsBody,
    ...rest
  }: ClaudecodeRuleParams) {
    // Validate frontmatter before calling super
    if (rest.validate) {
      const result = ClaudecodeRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // Root file: no frontmatter; Non-root file: with optional paths frontmatter
      fileContent: rest.root
        ? body
        : ClaudecodeRule.generateFileContent(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
    this.agentsBody = agentsBody ?? body;
  }

  getAgentsBody(): string {
    return this.agentsBody;
  }

  /**
   * Write the shared Instruction to AGENTS.md next to CLAUDE.md.
   * CLAUDE.md itself only contains `@AGENTS.md`.
   */
  static getRootMirror() {
    return {
      getMirrorFiles({
        outputRoot,
        rootRule,
      }: {
        outputRoot: string;
        rootRule: ToolRule;
        content: string;
      }): ToolRule[] {
        const agentsBody =
          rootRule instanceof ClaudecodeRule
            ? rootRule.getAgentsBody()
            : rootRule.getFileContent();
        const normalized = agentsBody.replace(/\s+$/, '');
        return [
          new AgentsMdRule({
            outputRoot,
            relativeDirPath: rootRule.getRelativeDirPath(),
            relativeFilePath: AGENTSMD_RULE_FILE_NAME,
            fileContent: normalized ? `${normalized}\n` : '\n',
            validate: false,
            root: rootRule.getRelativeDirPath() === '.',
          }),
        ];
      },
      getMirrorDeletionGlobs({
        outputRoot,
        global = false,
      }: {
        outputRoot: string;
        global?: boolean;
      }) {
        const paths = ClaudecodeRule.getSettablePaths({ global });
        return {
          primaryGlob: join(
            outputRoot,
            paths.root.relativeDirPath,
            paths.root.relativeFilePath,
          ),
          mirrorGlob: join(
            outputRoot,
            paths.root.relativeDirPath,
            AGENTSMD_RULE_FILE_NAME,
          ),
        };
      },
    };
  }

  private static generateFileContent(
    body: string,
    frontmatter: ClaudecodeRuleFrontmatter,
  ): string {
    // Only include frontmatter if paths is defined
    if (frontmatter.paths) {
      return stringifyFrontmatter(body, { paths: frontmatter.paths });
    }
    return body;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
    relativeDirPath: overrideDirPath,
  }: ToolRuleFromFileParams): Promise<ClaudecodeRule> {
    const paths = ClaudecodeRule.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const rootDirPath = overrideDirPath ?? paths.root.relativeDirPath;
      const fileContent = await readFileContent(
        join(outputRoot, rootDirPath, paths.root.relativeFilePath),
      );
      const raw = fileContent.trim();
      const isAgentsImport =
        raw === `@${AGENTSMD_RULE_FILE_NAME}` ||
        raw === CLAUDECODE_AGENTS_IMPORT.trim();
      let agentsBody = raw;
      if (isAgentsImport) {
        try {
          agentsBody = (
            await readFileContent(
              join(outputRoot, rootDirPath, AGENTSMD_RULE_FILE_NAME),
            )
          ).trim();
        } catch {
          // Keep the import text when AGENTS.md is missing.
        }
      }

      return new ClaudecodeRule({
        outputRoot,
        relativeDirPath: rootDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        frontmatter: {},
        body: isAgentsImport ? CLAUDECODE_AGENTS_IMPORT : raw,
        agentsBody,
        validate,
        root: true,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(`nonRoot path is not set for ${relativeFilePath}`);
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const filePath = join(outputRoot, relativePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(
      fileContent,
      filePath,
    );

    // Validate frontmatter
    const result = ClaudecodeRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${filePath}: ${formatError(result.error)}`,
      );
    }

    return new ClaudecodeRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
      root: false,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): ClaudecodeRule {
    const paths = ClaudecodeRule.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new ClaudecodeRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: '',
      validate: false,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ClaudecodeRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root ?? false;
    const paths = ClaudecodeRule.getSettablePaths({ global });

    // Claude rules are always loaded without path/glob applicability.
    // Keep SSOT globs available for targets that support scoped rules.
    const claudecodeFrontmatter: ClaudecodeRuleFrontmatter = {};

    const agentsBody = rulesyncRule.getBody();

    if (root) {
      return new ClaudecodeRule({
        outputRoot,
        frontmatter: claudecodeFrontmatter,
        body: CLAUDECODE_AGENTS_IMPORT,
        agentsBody,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        validate,
        root,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(
        `nonRoot path is not set for ${rulesyncRule.getRelativeFilePath()}`,
      );
    }

    return new ClaudecodeRule({
      outputRoot,
      frontmatter: claudecodeFrontmatter,
      body: agentsBody,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      validate,
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    // Convert paths field to globs array
    let globs: string[] | undefined;
    if (this.isRoot()) {
      globs = ['**/*'];
    } else if (this.frontmatter.paths) {
      // paths is already an array
      globs = this.frontmatter.paths;
    }

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      root: this.isRoot(),
      description: this.description,
      globs,
      ...(this.frontmatter.paths && {
        claudecode: { paths: this.frontmatter.paths },
      }),
    };

    return new RulesyncRule({
      outputRoot: this.getOutputRoot(),
      frontmatter: rulesyncFrontmatter,
      body: this.isRoot() ? this.agentsBody : this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ClaudecodeRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  getFrontmatter(): ClaudecodeRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return ClaudecodeRule.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: 'claudecode',
    });
  }
}
