import { join } from 'node:path';

import { SKILL_FILE_NAME } from '../constants/general.js';
import {
  RULESYNC_AGENTS_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from '../constants/rulesync-paths.js';

export type ScaffoldFeature = 'rule' | 'skill';

export type FeatureScaffold = {
  feature: ScaffoldFeature;
  relativeFilePath: string;
  candidateRelativeFilePaths: string[];
  content: string;
};

const FEATURE_KEYWORDS = new Map<string, ScaffoldFeature>([
  ['rule', 'rule'],
  ['rules', 'rule'],
  ['skill', 'skill'],
  ['skills', 'skill'],
]);

export function parseScaffoldFeatureKeyword(
  value: string,
): ScaffoldFeature | undefined {
  return FEATURE_KEYWORDS.get(value.toLowerCase());
}

export function isNamedScaffoldFeature(feature: ScaffoldFeature): boolean {
  return feature === 'rule' || feature === 'skill';
}

export function normalizeScaffoldName({
  feature,
  name,
}: {
  feature: ScaffoldFeature;
  name?: string;
}): string | undefined {
  if (!isNamedScaffoldFeature(feature)) {
    if (name !== undefined) {
      throw new Error(`Feature "${feature}" does not accept --name.`);
    }
    return undefined;
  }

  if (name === undefined || name.trim() === '') {
    throw new Error(`Feature "${feature}" requires --name <name>.`);
  }

  const normalized = name.trim().replace(/\.md$/i, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized)) {
    throw new Error(
      `Invalid ${feature} name "${name}". Use letters, numbers, dots, underscores, or hyphens without path separators.`,
    );
  }
  return normalized;
}

function agentsTemplate(): string {
  return `---
name: <agent-name>
description: <One-line summary of this agent's overall role>
---

# Role
<Define the agent's job and seniority in one or two sentences.>

# Context
- <Only the architecture and domain facts needed on most requests>
- <Key runtime, product, or repository constraints>

# How we work
- <Core convention someone would otherwise get wrong>
- <How to verify work and communicate decisions>
- <Team tone or collaboration rule>

# MUST / IMPORTANT
- When Transcodes MCP is installed, use Transcodes MCP tools for every operation they support.
- Never bypass an available Transcodes MCP tool or its permission and step-up flow by using Bash, shell, raw HTTP, or another indirect execution path. If authorization is required, complete that flow instead of rerouting the action.

# Output
- <Default language, length, and level of detail>
- <Required format for code, plans, or handoff summaries>

<!-- Aim for 500–1,500 tokens. Keep only guidance needed on nearly every
request. If this exceeds 2,000 tokens, move conditional policies to Rules and
repeatable procedures or examples to Skills. -->
`;
}

function ruleTemplate(name: string): string {
  if (name === 'agents') return agentsTemplate();

  return `---
description: Load when working on <when this rule should apply>
globs:
  - "<path/or/glob/**>"
---

# Must
- <One precise architecture, security, or development requirement>
- <How compliance is verified, when useful>

# Never
- <Specific forbidden pattern or action>
- <Required safe alternative, if one exists>

<!-- Keep one policy per Rule and aim for 100–500 tokens. If it needs multiple
unrelated Must/Never groups, split it into conditionally loaded Rules with
focused descriptions and globs. -->
`;
}

function skillTemplate(name: string): string {
  return `---
name: ${name}
description: Use when the user asks to <phrases they actually say>
---

# Prerequisites
- <Inputs, permissions, or project state required before starting>
- <How to obtain or validate anything missing>

# Steps
1. <Inspect or validate the starting state>
2. <Perform the workflow in a deterministic order>
3. <Verify the result and handle expected failure cases>

# Output
**Deliverable** — <exact shape / template of the result>
**Done when** — <observable completion criteria>

<!-- Aim for 500–2,000 tokens. Templates and concrete examples belong here.
If this exceeds 3,000 tokens or contains distinct workflows, split it into
smaller Skills with narrower triggers. -->
`;
}

export function createFeatureScaffold(params: {
  feature: ScaffoldFeature;
  name?: string;
  template?: string;
}): FeatureScaffold {
  const name = normalizeScaffoldName(params);
  if (params.feature === 'rule') {
    const relativeFilePath =
      name === 'agents'
        ? join(RULESYNC_AGENTS_RELATIVE_DIR_PATH, `${name}.md`)
        : join(RULESYNC_RULES_RELATIVE_DIR_PATH, `${name}.md`);
    return {
      feature: 'rule',
      relativeFilePath,
      candidateRelativeFilePaths: [relativeFilePath],
      content: ruleTemplate(name!),
    };
  }
  if (params.template && params.template !== 'general') {
    throw new Error(
      `Unknown skill template "${params.template}". Only "general" is supported.`,
    );
  }
  const relativeFilePath = join(
    RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    name!,
    SKILL_FILE_NAME,
  );
  return {
    feature: 'skill',
    relativeFilePath,
    candidateRelativeFilePaths: [relativeFilePath],
    content: skillTemplate(name!),
  };
}
