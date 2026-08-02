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
root: true
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

function skillTemplateGeneral(): string {
  return `---
name: <short-name>
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

function skillTemplateResearch(): string {
  return `---
name: research
description: Use when the user asks to research a market, competitor, or user problem — "조사해줘", "경쟁사 어때", "이거 시장 있어?", "레퍼런스 찾아줘"
---

# Prerequisites
- The decision this research is for, and when it is needed
- If missing: ask before searching — research without a decision behind it is wasted

# Steps
1. Write down what you already believe, before searching. Mark it as assumption, not fact.
2. Search. For each claim, keep the source and the date. Drop anything older than 12 months unless it is structural.
3. Look for evidence that contradicts step 1. If you find none, you searched too narrowly — search again with different terms.
4. Separate what the sources actually say from what you concluded.

# Output
**Question** — the decision this answers, in one line
**Answer** — 3 sentences max, up front
**Evidence** — 3–5 bullets, each with source and date
**Against it** — what the counter-evidence says
**Confidence** — high / medium / low, and what would change it
**Still unknown** — what you could not find out
**Done when** — every number has a source and date (or is marked "unverified"); counter-evidence is included, not omitted
`;
}

function skillTemplateImplement(): string {
  return `---
name: implement
description: Use when the user asks to build, add, or fix something in the codebase — "이 기능 만들어줘", "이거 고쳐줘", "버그 잡아줘", "리팩터링해줘"
---

# Prerequisites
- What "done" looks like — what should work after this that does not now
- If missing: ask before writing code

# Steps
1. Read the existing code around the change before writing anything. Match what is already there over what you would prefer.
2. Make the smallest change that satisfies the requirement. Leave unrelated code alone.
3. Run the tests and the build. If either fails, fix it before returning.
4. Re-read your own diff. Remove anything you added that is not needed.

# Output
**What changed** — one line per file
**Why** — the reasoning behind any non-obvious choice
**Verified** — the exact commands you ran and their result
**Not done** — anything you skipped, and why
**Done when** — tests and build pass for the change; no files outside the requested scope were touched without saying so first
`;
}

function skillTemplateGrowth(): string {
  return `---
name: growth
description: Use when the user asks to grow a metric, run an experiment, or fix a funnel — "전환율 올리고 싶어", "카피 뭐가 나아?", "이거 왜 안 팔려?", "실험 설계해줘"
---

# Prerequisites
- Which single number should move, and from what to what ("growth" is not a metric)
- If missing: ask before proposing experiments

# Steps
1. Find where the funnel actually leaks before proposing anything. Name the step and the drop-off.
2. Write the guess as a testable sentence: change X → Y moves → because Z.
3. Estimate the sample you need. If current traffic cannot produce a readable result in 2 weeks, say so and propose a qualitative check instead.
4. Ship the smallest version that tests the guess. One variable at a time.

# Output
**Metric** — the one number, current → target
**Leak** — which step loses people, with the drop-off
**Hypothesis** — change X → Y moves → because Z
**Test** — what ships, to whom, for how long
**Readable?** — sample needed vs. traffic available
**Kill criteria** — what result means stop
**Done when** — one variable is being tested; the metric named is the one that pays (not a vanity proxy)
`;
}

function skillTemplateMarketingCopy(): string {
  return `---
name: marketing-copy
description: Use when the user asks to write or fix marketing copy — landing pages, ads, emails, product pages, social posts
---

# Prerequisites
- Who reads this, and what they should do after
- If missing: ask — no audience, no copy

# Steps
1. Name the pain in their words, not ours. Use phrases they actually say, not our product vocabulary.
2. Write the hook first — one line, the benefit, no setup. Then the rest.
3. Cut every sentence that does not move them toward the action.
4. Read it aloud. If it sounds like a company wrote it, rewrite it.

# Output
**Audience** — who, and what they want
**Hook** — one line
**Body** — the copy itself
**CTA** — the exact button or link text
**Cut** — what you removed and why
**Done when** — the hook leads with what breaks without the product; no unverified numbers, results, or testimonials
`;
}

function skillTemplate(template: string): string {
  if (template === 'research') return skillTemplateResearch();
  if (template === 'implement') return skillTemplateImplement();
  if (template === 'growth') return skillTemplateGrowth();
  if (template === 'marketing-copy') return skillTemplateMarketingCopy();
  return skillTemplateGeneral();
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
  const relativeFilePath = join(
    RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    name!,
    SKILL_FILE_NAME,
  );
  return {
    feature: 'skill',
    relativeFilePath,
    candidateRelativeFilePaths: [relativeFilePath],
    content: skillTemplate(params.template || 'general'),
  };
}
