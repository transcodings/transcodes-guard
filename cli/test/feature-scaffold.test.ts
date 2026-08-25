import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coerceSkillName,
  createFeatureScaffold,
  parseSkillOptionalDirs,
  parseSkillScriptLanguage,
  SKILL_OPTIONAL_DIRS,
  TRANSCODES_ATTRIBUTION_OUTPUT_LINE,
  TRANSCODES_MCP_MUST_LINES,
} from '../src/commands/sync/lib/feature-scaffold.js';
import {
  assertSkillFilePath,
  ensurePersonaInstructionOutput,
} from '../src/commands/transcodes/persona.js';

test('every generated Instruction requires a compact Persona attribution line', () => {
  const instruction = createFeatureScaffold({
    feature: 'rule',
    name: 'agents',
  });

  assert.match(instruction.content, /^# Output$/m);
  assert.match(
    instruction.content,
    /Persona <name or none> · Rules <comma-separated Rule names or none> · Skills <comma-separated Skill names or none> · Knowledge <comma-separated Knowledge Base names or none>/,
  );
  assert.match(instruction.content, /write `none` after Persona/);
  assert.match(instruction.content, /Keep all four categories/);
  assert.match(instruction.content, /installed or read/);
  assert.match(instruction.content, /platform, system, or host instructions/);
  assert.ok(instruction.content.includes(TRANSCODES_ATTRIBUTION_OUTPUT_LINE));
  assert.doesNotMatch(instruction.content, /# MUST \/ IMPORTANT/);
  for (const line of TRANSCODES_MCP_MUST_LINES) {
    assert.ok(!instruction.content.includes(line));
  }
});

test('generated Rule and Skill files never contain Transcodes attribution', () => {
  const rule = createFeatureScaffold({
    feature: 'rule',
    name: 'quality-verification',
  });
  const skill = createFeatureScaffold({
    feature: 'skill',
    name: 'code-review',
  });

  assert.ok(!rule.content.includes(TRANSCODES_ATTRIBUTION_OUTPUT_LINE));
  assert.ok(!skill.content.includes(TRANSCODES_ATTRIBUTION_OUTPUT_LINE));
});

test('Persona Instruction attribution is restored with its exact name', () => {
  const content = ensurePersonaInstructionOutput(
    '# Role\nDeveloper\n',
    'product-manager',
  );

  assert.match(content, /^# Output$/m);
  assert.match(
    content,
    /The active Transcodes Persona is `product-manager`; use that exact name after Persona\./,
  );
  assert.match(
    content,
    /Persona <name or none> · Rules <comma-separated Rule names or none>/,
  );
  assert.match(content, /Knowledge <comma-separated Knowledge Base names or none>/);
});

test('skill scaffold defaults to SKILL.md only', () => {
  const skill = createFeatureScaffold({ feature: 'skill', name: 'code-review' });

  assert.equal(skill.relativeFilePath.endsWith('SKILL.md'), true);
  assert.deepEqual(skill.extraFiles, []);
});

test('skill scaffold adds optional directories on request', () => {
  const skill = createFeatureScaffold({
    feature: 'skill',
    name: 'pdf-processing',
    include: [...SKILL_OPTIONAL_DIRS],
  });

  const extraPaths = skill.extraFiles.map((file) => file.relativeFilePath);
  assert.equal(
    extraPaths.some((p) => p.endsWith('scripts/.gitkeep')),
    true,
  );
  assert.equal(
    extraPaths.some((p) => p.endsWith('references/reference.md')),
    true,
  );
  assert.equal(
    extraPaths.some((p) => p.endsWith('assets/.gitkeep')),
    true,
  );
  const reference = skill.extraFiles.find((file) =>
    file.relativeFilePath.endsWith('reference.md'),
  );
  assert.match(reference!.content, /loaded\non demand/);
});

test('script language aliases resolve and unknown ones fail', () => {
  assert.equal(parseSkillScriptLanguage('py'), 'python');
  assert.equal(parseSkillScriptLanguage('JavaScript'), 'node');
  assert.equal(parseSkillScriptLanguage('sh'), 'bash');
  assert.throws(() => parseSkillScriptLanguage('rust'));
});

test('--lang scaffolds a starter script instead of .gitkeep', () => {
  const skill = createFeatureScaffold({
    feature: 'skill',
    name: 'pdf-processing',
    scriptLanguage: 'python',
  });

  const script = skill.extraFiles.find((file) =>
    file.relativeFilePath.endsWith('scripts/example.py'),
  );
  assert.ok(script, 'expected scripts/example.py to be scaffolded');
  assert.match(script!.content, /^#!\/usr\/bin\/env python3/);
  assert.match(script!.content, /pdf-processing/);
  // The language implies scripts/, so no placeholder file is needed.
  assert.equal(
    skill.extraFiles.some((file) =>
      file.relativeFilePath.endsWith('scripts/.gitkeep'),
    ),
    false,
  );
});

test('starter scripts follow the agentic script contract', () => {
  for (const [language, marker] of [
    ['python', '#!/usr/bin/env python3'],
    ['node', '#!/usr/bin/env node'],
    ['bash', '#!/usr/bin/env bash'],
  ] as const) {
    const skill = createFeatureScaffold({
      feature: 'skill',
      name: 'pdf-processing',
      scriptLanguage: language,
    });
    const script = skill.extraFiles.find((file) =>
      /scripts\/example\.(py|js|sh)$/.test(file.relativeFilePath),
    );
    assert.ok(script, `expected a ${language} starter script`);
    assert.ok(script.content.startsWith(marker));
    // Self-documenting, non-interactive, stderr diagnostics, non-zero exit.
    assert.match(script.content, /--help/);
    assert.match(script.content, /non-interactively/);
    assert.match(script.content, /stderr/);
    assert.match(script.content, /exit 2|return 2|process\.exit\(2\)/);
  }

  const python = createFeatureScaffold({
    feature: 'skill',
    name: 'pdf-processing',
    scriptLanguage: 'python',
  }).extraFiles.find((file) => file.relativeFilePath.endsWith('example.py'));
  assert.ok(python, 'expected the python starter script');
  // PEP 723 inline dependency block for uv run.
  assert.match(python.content, /\/\/\/ script/);
  assert.match(python.content, /dependencies = \[\]/);
});

test('SKILL.md points at companion directories without assuming a language', () => {
  const skill = createFeatureScaffold({
    feature: 'skill',
    name: 'pdf-processing',
    include: ['references'],
    scriptLanguage: 'python',
  });
  assert.match(skill.content, /^# Available scripts$/m);
  assert.match(skill.content, /`scripts\/`/);
  assert.match(skill.content, /^# References$/m);
  assert.match(skill.content, /`references\/`/);
  // Directory-only mentions: no file names, run commands, or language.
  assert.doesNotMatch(skill.content, /example\.py/);
  assert.doesNotMatch(skill.content, /python/);

  // The section is identical when scripts/ is scaffolded without a language.
  const dirOnly = createFeatureScaffold({
    feature: 'skill',
    name: 'pdf-processing',
    include: ['scripts'],
  });
  assert.match(dirOnly.content, /^# Available scripts$/m);
  assert.match(dirOnly.content, /`scripts\/`/);
  assert.doesNotMatch(dirOnly.content, /^# References$/m);

  // The default SKILL.md-only scaffold stays free of companion sections.
  const plain = createFeatureScaffold({ feature: 'skill', name: 'plain' });
  assert.doesNotMatch(plain.content, /^# Available scripts$/m);
  assert.doesNotMatch(plain.content, /^# References$/m);
});

test('Steps prompt for the companion command, not just the index', () => {
  const both = createFeatureScaffold({
    feature: 'skill',
    name: 'pdf-processing',
    include: ['scripts', 'references'],
  });
  const steps = both.content.slice(
    both.content.indexOf('# Steps'),
    both.content.indexOf('# Gotchas'),
  );
  assert.match(steps, /Read `references\/<doc>\.md`/);
  assert.match(steps, /Run `<interpreter> scripts\/<script>`/);
  assert.match(steps, /do not hand-write the result/);

  // Nothing companion-related leaks into a SKILL.md-only scaffold.
  const plain = createFeatureScaffold({ feature: 'skill', name: 'plain' });
  const plainSteps = plain.content.slice(
    plain.content.indexOf('# Steps'),
    plain.content.indexOf('# Gotchas'),
  );
  assert.doesNotMatch(plainSteps, /scripts\/|references\//);
});

test('--full plus a language keeps the other directories intact', () => {
  const skill = createFeatureScaffold({
    feature: 'skill',
    name: 'pdf-processing',
    include: [...SKILL_OPTIONAL_DIRS],
    scriptLanguage: 'bash',
  });

  const extraPaths = skill.extraFiles.map((file) => file.relativeFilePath);
  assert.equal(
    extraPaths.some((p) => p.endsWith('scripts/example.sh')),
    true,
  );
  assert.equal(
    extraPaths.some((p) => p.endsWith('references/reference.md')),
    true,
  );
  assert.equal(
    extraPaths.some((p) => p.endsWith('assets/.gitkeep')),
    true,
  );
});

test('rules never accept a script language', () => {
  assert.throws(() =>
    createFeatureScaffold({
      feature: 'rule',
      name: 'quality',
      scriptLanguage: 'python',
    }),
  );
});

test('rules never accept optional skill directories', () => {
  assert.throws(() =>
    createFeatureScaffold({
      feature: 'rule',
      name: 'quality',
      include: ['scripts'],
    }),
  );
});

test('rule names must already be lowercase kebab-case', () => {
  assert.match(
    createFeatureScaffold({ feature: 'rule', name: 'Quality Check' })
      .relativeFilePath,
    /rules\/quality-check\.md$/,
  );
  assert.throws(
    () => createFeatureScaffold({ feature: 'rule', name: 'design_tokens' }),
    /kebab-case/,
  );
});

test('skill names are coerced to the Agent Skills spec form', () => {
  assert.equal(coerceSkillName('My_Skill.md'), 'my-skill');
  assert.equal(coerceSkillName('PDF  Processing'), 'pdf-processing');
  assert.equal(coerceSkillName('--weird--'), 'weird');
  assert.equal(coerceSkillName('***'), '');

  const skill = createFeatureScaffold({
    feature: 'skill',
    name: 'PDF Processing',
  });
  assert.match(skill.relativeFilePath, /skills\/pdf-processing\//);
  assert.match(skill.content, /^name: pdf-processing$/m);
});

test('parseSkillOptionalDirs validates and dedupes directory names', () => {
  assert.deepEqual(parseSkillOptionalDirs(['scripts', 'Scripts', 'assets']), [
    'scripts',
    'assets',
  ]);
  assert.throws(() => parseSkillOptionalDirs(['docs']));
});

test('skill file paths stay inside the skill folder', () => {
  assert.equal(assertSkillFilePath(''), 'SKILL.md');
  assert.equal(
    assertSkillFilePath('scripts/extract.py'),
    'scripts/extract.py',
  );
  assert.throws(() => assertSkillFilePath('../other/SKILL.md'));
  assert.throws(() => assertSkillFilePath('scripts/../../escape.md'));
  assert.throws(() => assertSkillFilePath('.hidden'));
  assert.throws(() => assertSkillFilePath('/etc/passwd'));
  assert.equal(
    assertSkillFilePath('modes/cinematic/_archive/champion/spec.md'),
    'modes/cinematic/_archive/champion/spec.md',
  );
  assert.equal(
    assertSkillFilePath('references/billing-api.md'),
    'references/billing-api.md',
  );
  assert.equal(
    assertSkillFilePath('references/guide.pdf'),
    'references/guide.pdf',
  );
});

test('legacy Instruction attribution is replaced without duplication', () => {
  const legacy =
    '- If any Rules or Skills were applied, you MUST include a list of the names of the Rules and Skills in the response.';
  const technical =
    '- The active Transcodes Persona is `developer`. When completing a task, end the response with exactly one short Transcodes attribution line: old technical format.';
  const content = ensurePersonaInstructionOutput(
    `# Output\n${legacy}\n${technical}\n`,
    'developer',
  );

  assert.equal(
    content.match(/exactly one Transcodes attribution line/g)?.length,
    1,
  );
  assert.ok(!content.includes(legacy));
  assert.ok(!content.includes(technical));
  assert.match(
    content,
    /The active Transcodes Persona is `developer`; use that exact name after Persona\./,
  );
});
