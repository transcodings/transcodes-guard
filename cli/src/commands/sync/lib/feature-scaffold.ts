import { join } from 'node:path';

import { SKILL_FILE_NAME } from '../constants/general.js';
import {
  RULESYNC_AGENTS_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from '../constants/rulesync-paths.js';

export type ScaffoldFeature = 'rule' | 'skill';

export type ScaffoldFile = {
  relativeFilePath: string;
  content: string;
};

export type FeatureScaffold = {
  feature: ScaffoldFeature;
  relativeFilePath: string;
  candidateRelativeFilePaths: string[];
  content: string;
  /** Optional companion files (e.g. a Skill's scripts/references/assets). */
  extraFiles: ScaffoldFile[];
};

/** Optional Skill companion directories from the Agent Skills spec. */
export const SKILL_OPTIONAL_DIRS = ['scripts', 'references', 'assets'] as const;

export type SkillOptionalDir = (typeof SKILL_OPTIONAL_DIRS)[number];

export function parseSkillOptionalDirs(values: string[]): SkillOptionalDir[] {
  const dirs: SkillOptionalDir[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    if (!(SKILL_OPTIONAL_DIRS as readonly string[]).includes(normalized)) {
      throw new Error(
        `Unknown skill directory "${value}". Use ${SKILL_OPTIONAL_DIRS.join(
          ', ',
        )}.`,
      );
    }
    if (!dirs.includes(normalized as SkillOptionalDir)) {
      dirs.push(normalized as SkillOptionalDir);
    }
  }
  return dirs;
}

/**
 * Coerce a name into the Agent Skills spec form: lowercase letters, digits,
 * and single hyphens, no leading/trailing hyphen, at most 64 characters.
 */
export function coerceSkillName(name: string): string {
  return name
    .trim()
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

export const APPLIED_RULES_SKILLS_OUTPUT_LINE =
  '- When any Rule or Skill is applied, you MUST end the response with exactly one attribution line in this format: `Applied: Rules <comma-separated Rule names or none> · Skills <comma-separated Skill names or none>`. Use the exact Rule and Skill names, include every applied item, and never replace names with generic descriptions. Omit this line only when no Rule or Skill was applied.';

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

  // Skill folder names follow the Agent Skills spec (lowercase, digits,
  // single hyphens) because the frontmatter `name` must match the directory.
  if (feature === 'skill') {
    const coerced = coerceSkillName(name);
    if (!coerced) {
      throw new Error(
        `Invalid skill name "${name}". Use lowercase letters, numbers, and hyphens (e.g. "pdf-processing").`,
      );
    }
    return coerced;
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
${APPLIED_RULES_SKILLS_OUTPUT_LINE}

<!-- Aim for 500–1,500 tokens. Keep only guidance needed on nearly every
request. If this exceeds 2,000 tokens, move conditional policies to Rules and
repeatable procedures or examples to Skills. -->
`;
}

function ruleTemplate(name: string): string {
  if (name === 'agents') {
    return agentsTemplate();
  }

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

function skillTemplate(name: string, include: SkillOptionalDir[] = []): string {
  // agentskills.io/skill-creation/using-scripts: companions only get used when
  // a Step tells the agent to run or read them. Scaffold points at the
  // directory; persona save fills the index. The agent replaces these Step
  // placeholders with the real command when it writes the workflow.
  const scriptsSection = include.includes('scripts')
    ? `
# Available scripts
- \`scripts/\` — <each script: what it does; the run command belongs in the Step that uses it>
`
    : '';
  const referencesSection = include.includes('references')
    ? `
# References
- \`references/\` — <each document: what it covers; the read instruction belongs in the Step that needs it>
`
    : '';
  // Placeholder paths stay generic on purpose: a real companion path here would
  // count as an existing mention and suppress its index bullet on save.
  const stepsCompanionHints = [
    include.includes('references')
      ? '   <If a document defines the convention: Read `references/<doc>.md` before deciding — do not guess it.>'
      : '',
    include.includes('scripts')
      ? '   <If a script does this step, put its exact command here: Run `<interpreter> scripts/<script>` — do not hand-write the result.>'
      : '',
  ].filter(Boolean);
  const stepsHintBlock =
    stepsCompanionHints.length > 0 ? `\n${stepsCompanionHints.join('\n')}` : '';
  return `---
name: ${name}
description: <What this Skill does and when to use it — include phrases the user actually says>
---

# Prerequisites
- <Inputs, permissions, or project state required before starting>
- <How to obtain or validate anything missing>

# Steps
1. <Inspect or validate the starting state>
2. <Perform the workflow in a deterministic order>${stepsHintBlock}
3. <Verify the result and handle expected failure cases>

# Gotchas
- <Environment-specific fact the agent would get wrong without being told>
${scriptsSection}${referencesSection}
# Output
**Deliverable** — <exact shape / template of the result>
**Done when** — <observable completion criteria>

<!-- Aim for 500–2,000 tokens and keep SKILL.md under 500 lines. Templates and
concrete examples belong here. Move long reference docs to references/*.md
(Markdown only). Write tables as GFM tables and diagrams as mermaid fences
— do not screenshot them as PNG/PDF. Put executable helpers in scripts/.
"# Available scripts" and "# References" are only an index: every companion
must also appear inside the Step that uses it, written as the literal command
or read instruction (e.g. "Run \`node scripts/generate-dto.js <Feature>\`" or
"Read \`references/REFERENCE.md\` before designing"), and close the shortcut
("Do not hand-write it"). A companion mentioned only in the index gets read as
optional background and skipped. If this exceeds 3,000 tokens or contains
distinct workflows, split it into smaller Skills. -->
`;
}

function skillReferenceTemplate(name: string): string {
  return `# ${name} — reference

<!-- Detailed reference material for the ${name} Skill. This file is loaded
on demand, not with SKILL.md — keep it focused, and put the read instruction
inside the SKILL.md Step that needs it (e.g. "Read references/REFERENCE.md
before designing the contract"), not only under "# References". -->
`;
}

/** Starter script languages for a Skill's scripts/ directory. */
export const SKILL_SCRIPT_LANGUAGES = ['python', 'node', 'bash'] as const;

export type SkillScriptLanguage = (typeof SKILL_SCRIPT_LANGUAGES)[number];

const SKILL_SCRIPT_LANGUAGE_ALIASES: Record<string, SkillScriptLanguage> = {
  python: 'python',
  py: 'python',
  python3: 'python',
  node: 'node',
  nodejs: 'node',
  javascript: 'node',
  js: 'node',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
};

export function parseSkillScriptLanguage(value: string): SkillScriptLanguage {
  const language = SKILL_SCRIPT_LANGUAGE_ALIASES[value.trim().toLowerCase()];
  if (!language) {
    throw new Error(
      `Unknown script language "${value}". Use ${SKILL_SCRIPT_LANGUAGES.join(
        ', ',
      )}.`,
    );
  }
  return language;
}

type SkillScript = {
  fileName: string;
  content: string;
};

// Starters follow agentskills.io/skill-creation/using-scripts: document
// themselves via --help, never prompt (agents run them non-interactively),
// print data to stdout and diagnostics to stderr, and exit non-zero on
// failure so the agent can react.
function skillScriptFile(
  name: string,
  language: SkillScriptLanguage,
): SkillScript {
  if (language === 'python') {
    return {
      fileName: 'example.py',
      content: `#!/usr/bin/env python3
"""Helper script for the ${name} Skill.

Rename this file after what it does (e.g. extract.py). In SKILL.md, put the
literal command inside the Step that uses it ("Run python3 scripts/extract.py
<input>. Do not hand-write it.") — listing it only under "# Available scripts"
gets it treated as optional background and skipped.

Agents run scripts non-interactively: accept input via flags and arguments,
never prompt. Print result data to stdout and diagnostics to stderr, and
exit non-zero on failure so the agent can react.
"""
# Third-party packages? Declare them inline (PEP 723) and have the agent run
# "uv run scripts/example.py" instead of python3:
# /// script
# dependencies = []
# ///

import json
import sys

USAGE = """\\
Usage: python3 scripts/example.py [--help] <input>

Does one deterministic step of the ${name} workflow.

Options:
  --help  Show this message and exit.
"""


def main(argv: list[str]) -> int:
    if "--help" in argv:
        print(USAGE, end="")
        return 0
    if not argv:
        print("Error: <input> is required.", file=sys.stderr)
        print(USAGE, file=sys.stderr, end="")
        return 2
    # <Do one deterministic step of the workflow here>
    print(json.dumps({"ok": True, "input": argv[0]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
`,
    };
  }
  if (language === 'node') {
    return {
      fileName: 'example.js',
      content: `#!/usr/bin/env node
// Helper script for the ${name} Skill.
//
// Rename this file after what it does (e.g. extract.js). In SKILL.md, put the
// literal command inside the Step that uses it ("Run node scripts/extract.js
// <input>. Do not hand-write it.") — listing it only under "# Available
// scripts" gets it treated as optional background and skipped.
//
// Agents run scripts non-interactively: accept input via flags and arguments,
// never prompt. Print result data to stdout and diagnostics to stderr, and
// exit non-zero on failure so the agent can react.

const USAGE = \`Usage: node scripts/example.js [--help] <input>

Does one deterministic step of the ${name} workflow.

Options:
  --help  Show this message and exit.\`;

const [, , ...args] = process.argv;

if (args.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}
if (args.length === 0) {
  console.error('Error: <input> is required.');
  console.error(USAGE);
  process.exit(2);
}

// <Do one deterministic step of the workflow here>
console.log(JSON.stringify({ ok: true, input: args[0] }));
`,
    };
  }
  return {
    fileName: 'example.sh',
    content: `#!/usr/bin/env bash
# Helper script for the ${name} Skill.
#
# Rename this file after what it does (e.g. extract.sh). In SKILL.md, put the
# literal command inside the Step that uses it ("Run bash scripts/extract.sh
# <input>. Do not hand-write it.") — listing it only under "# Available
# scripts" gets it treated as optional background and skipped.
#
# Agents run scripts non-interactively: accept input via flags and arguments,
# never prompt. Print result data to stdout and diagnostics to stderr, and
# exit non-zero on failure so the agent can react.
set -euo pipefail

usage() {
  echo 'Usage: bash scripts/example.sh [--help] <input>'
  echo ''
  echo 'Does one deterministic step of the ${name} workflow.'
  echo ''
  echo 'Options:'
  echo '  --help  Show this message and exit.'
}

if [ "\${1:-}" = "--help" ]; then
  usage
  exit 0
fi
if [ "$#" -lt 1 ]; then
  echo 'Error: <input> is required.' >&2
  usage >&2
  exit 2
fi

# <Do one deterministic step of the workflow here>
printf '{"ok": true, "input": "%s"}\\n' "$1"
`,
  };
}

function skillExtraFiles(
  name: string,
  include: SkillOptionalDir[],
  script?: SkillScript,
): ScaffoldFile[] {
  const skillDir = join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, name);
  const files: ScaffoldFile[] = [];
  for (const dir of SKILL_OPTIONAL_DIRS) {
    if (!include.includes(dir)) continue;
    if (dir === 'references') {
      files.push({
        relativeFilePath: join(skillDir, 'references', 'REFERENCE.md'),
        content: skillReferenceTemplate(name),
      });
    } else if (dir === 'scripts' && script) {
      files.push({
        relativeFilePath: join(skillDir, 'scripts', script.fileName),
        content: script.content,
      });
    } else {
      // Git does not track empty directories; .gitkeep keeps them in the repo.
      files.push({
        relativeFilePath: join(skillDir, dir, '.gitkeep'),
        content: '',
      });
    }
  }
  return files;
}

export function createFeatureScaffold(params: {
  feature: ScaffoldFeature;
  name?: string;
  template?: string;
  /** Optional Skill directories to scaffold alongside SKILL.md. */
  include?: SkillOptionalDir[];
  /** Starter script language for scripts/ (implies including scripts/). */
  scriptLanguage?: SkillScriptLanguage;
}): FeatureScaffold {
  const name = normalizeScaffoldName(params);
  if (params.feature === 'rule') {
    if (params.include && params.include.length > 0) {
      throw new Error('Only skills accept optional directories (--folder).');
    }
    if (params.scriptLanguage) {
      throw new Error('Only skills accept a script language (--lang).');
    }
    const relativeFilePath =
      name === 'agents'
        ? join(RULESYNC_AGENTS_RELATIVE_DIR_PATH, `${name}.md`)
        : join(RULESYNC_RULES_RELATIVE_DIR_PATH, `${name}.md`);
    return {
      feature: 'rule',
      relativeFilePath,
      candidateRelativeFilePaths: [relativeFilePath],
      content: ruleTemplate(name!),
      extraFiles: [],
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
  // A script language only makes sense with a scripts/ directory, so asking
  // for one pulls the directory in without requiring --folder scripts too.
  const include = [...(params.include ?? [])];
  if (params.scriptLanguage && !include.includes('scripts')) {
    include.push('scripts');
  }
  const script = params.scriptLanguage
    ? skillScriptFile(name!, params.scriptLanguage)
    : undefined;
  return {
    feature: 'skill',
    relativeFilePath,
    candidateRelativeFilePaths: [relativeFilePath],
    content: skillTemplate(name!, include),
    extraFiles: skillExtraFiles(name!, include, script),
  };
}
