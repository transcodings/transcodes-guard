import { ANTIGRAVITY_PLUGIN_SKILLS_DIR } from '../../constants/plugin-paths.js';
import { AntigravityIdeSkill } from './antigravity-ide-skill.js';
import type { RulesyncSkill } from './rulesync-skill.js';
import type { ToolSkillSettablePaths } from './tool-skill.js';

export class AntigravityPluginSkill extends AntigravityIdeSkill {
  static override isTargetedByRulesyncSkill(
    _rulesyncSkill: RulesyncSkill,
  ): boolean {
    return true;
  }

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: ANTIGRAVITY_PLUGIN_SKILLS_DIR };
  }
}
