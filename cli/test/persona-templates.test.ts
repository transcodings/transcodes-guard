import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coerceSkillName,
  TRANSCODES_ATTRIBUTION_OUTPUT_LINE,
  TRANSCODES_MCP_MUST_LINES,
} from '../src/commands/sync/lib/feature-scaffold.js';
import {
  assertPersonaId,
  assertPersonaName,
} from '../src/commands/transcodes/persona.js';
import {
  findPersonaTemplate,
  PERSONA_TEMPLATES,
  personaTemplateSummaries,
} from '../src/commands/transcodes/persona-templates.js';

test('the catalog offers the six dashboard templates in order', () => {
  assert.deepEqual(
    PERSONA_TEMPLATES.map((template) => template.id),
    [
      'minimum',
      'landing-page-publisher',
      'fullstack-developer',
      'ui-ux-designer',
      'marketer',
      'researcher',
    ],
  );
  assert.deepEqual(
    PERSONA_TEMPLATES.map((template) => template.title),
    [
      'Minimum',
      'Landing Page Publisher',
      'Fullstack Developer',
      'UI/UX Designer',
      'Marketer',
      'Researcher',
    ],
  );
});

test('Minimum ships the starter Rule and Skill structure', () => {
  const minimum = findPersonaTemplate('minimum');
  assert.ok(minimum);
  assert.match(minimum.instruction, /^# Role$/m);
  assert.match(minimum.instruction, /<Define the agent's job/);
  assert.deepEqual(
    minimum.rules.map((entry) => entry.name),
    ['example-rule'],
  );
  assert.deepEqual(
    minimum.skills.map((entry) => entry.name),
    ['example-skill'],
  );
  assert.deepEqual(
    minimum.knowledge.map((entry) => entry.name),
    ['what-belongs-here', 'project-facts'],
  );
  const starterRule = minimum.rules.find(
    (entry) => entry.name === 'example-rule',
  );
  const starterSkill = minimum.skills.find(
    (entry) => entry.name === 'example-skill',
  );
  assert.ok(starterRule);
  assert.ok(starterSkill);
  assert.match(starterRule.content, /<when this rule should apply>/);
  assert.match(
    starterSkill.content,
    /<What this Skill does and when to use it/,
  );

  for (const template of PERSONA_TEMPLATES) {
    assert.ok(
      template.rules.length + template.skills.length > 0,
      `${template.id} has no Rules or Skills`,
    );
  }
});

test('template instructions match the generated Instruction contract', () => {
  for (const template of PERSONA_TEMPLATES) {
    const { instruction, id } = template;
    // The Persona instruction is stored without frontmatter, so writing one
    // here would silently lose the first section on save.
    assert.ok(
      !instruction.startsWith('---'),
      `${id} instruction starts with frontmatter`,
    );
    for (const heading of [
      '# Role',
      '# Context',
      '# How we work',
      '# Output',
    ]) {
      assert.match(
        instruction,
        new RegExp(`^${heading.replace('/', '\\/')}$`, 'm'),
        `${id} instruction is missing "${heading}"`,
      );
    }
    assert.doesNotMatch(
      instruction,
      /# MUST \/ IMPORTANT/,
      `${id} instruction still has a MUST / IMPORTANT section`,
    );
    for (const line of TRANSCODES_MCP_MUST_LINES) {
      assert.ok(
        !instruction.includes(line),
        `${id} instruction still has an MCP MUST line`,
      );
    }
    assert.ok(
      instruction.includes(TRANSCODES_ATTRIBUTION_OUTPUT_LINE),
      `${id} instruction is missing the attribution line`,
    );
    assert.match(
      instruction,
      /Read the Knowledge Base entry whose description matches/,
      `${id} instruction does not tell the agent to read Knowledge Base`,
    );
  }
});

test('template Rules carry a description, globs, and Must/Never sections', () => {
  for (const template of PERSONA_TEMPLATES) {
    for (const rule of template.rules) {
      assert.equal(assertPersonaName('rule', rule.name), rule.name);
      assert.ok(
        rule.content.startsWith('---\ndescription: Load when '),
        `${template.id}/${rule.name} has no loading condition`,
      );
      assert.match(rule.content, /^globs:$/m);
      assert.match(rule.content, /^ {2}- "[^"]+"$/m);
      assert.match(rule.content, /^# Must$/m);
      assert.match(rule.content, /^# Never$/m);
      // Attribution belongs to the Instruction only.
      assert.ok(!rule.content.includes(TRANSCODES_ATTRIBUTION_OUTPUT_LINE));
    }
  }
});

test('template Skills keep frontmatter name in sync with the folder name', () => {
  for (const template of PERSONA_TEMPLATES) {
    for (const skill of template.skills) {
      assert.equal(
        coerceSkillName(skill.name),
        skill.name,
        `${skill.name} is not a spec-compliant Skill folder name`,
      );
      assert.equal(assertPersonaName('skill', skill.name), skill.name);
      assert.match(skill.content, new RegExp(`^name: ${skill.name}$`, 'm'));
      assert.match(skill.content, /^description: .+$/m);
      for (const heading of [
        '# Prerequisites',
        '# Steps',
        '# Gotchas',
        '# Output',
      ]) {
        assert.match(
          skill.content,
          new RegExp(`^${heading}$`, 'm'),
          `${skill.name} is missing "${heading}"`,
        );
      }
      assert.match(skill.content, /^\*\*Deliverable\*\* — .+$/m);
      assert.match(skill.content, /^\*\*Done when\*\* — .+$/m);
      assert.match(skill.content, /^1\. /m);
      // Companion index sections only belong in Skills that ship companions.
      assert.ok(!skill.content.includes('# Available scripts'));
      assert.ok(!skill.content.includes('# References'));
    }
  }
});

test('suggested Persona names survive the id normalizer unchanged', () => {
  for (const template of PERSONA_TEMPLATES) {
    assert.equal(assertPersonaId(template.suggestedName), template.suggestedName);
  }
});

test('summaries expose card metadata without the bundle bodies', () => {
  const summaries = personaTemplateSummaries();
  assert.equal(summaries.length, PERSONA_TEMPLATES.length);
  for (const [index, summary] of summaries.entries()) {
    const template = PERSONA_TEMPLATES[index];
    assert.ok(template);
    assert.equal(summary.id, template.id);
    assert.equal(summary.title, template.title);
    assert.equal(summary.suggestedName, template.suggestedName);
    assert.ok(summary.summary.length > 0);
    assert.deepEqual(
      summary.rules,
      template.rules.map((rule) => rule.name),
    );
    assert.deepEqual(
      summary.skills,
      template.skills.map((skill) => skill.name),
    );
    assert.deepEqual(summary.knowledge, [
      'knowledge-base',
      ...template.knowledge.map((entry) => entry.name),
    ]);
    assert.ok(template.knowledge.length >= 2);
    assert.equal(template.knowledge[0]?.name, 'what-belongs-here');
    assert.match(
      template.knowledge[0]?.content ?? '',
      /When should this knowledge be referenced/,
    );
    assert.ok(!('instruction' in summary));
  }
});

test('template lookup is case-insensitive and rejects unknown ids', () => {
  assert.equal(findPersonaTemplate('  Marketer ')?.id, 'marketer');
  assert.equal(findPersonaTemplate('nope'), undefined);
});
