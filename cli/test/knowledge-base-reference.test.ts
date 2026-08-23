import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertKnowledgeBaseBundleFiles,
  assertPersonaId,
  assertPersonaName,
  collectPersonaFiles,
  createPersona,
  createSkillFolder,
  deletePersonaFile,
  deleteSkillPath,
  KNOWLEDGE_BASE_SKILL_NAME,
  KNOWLEDGE_BASE_STARTER_NAME,
  knowledgeFileSlug,
  knowledgeReferenceIdentity,
  listPersona,
  savePersonaBatch,
  savePersonaFile,
} from '../src/commands/transcodes/persona.js';

async function isolatedHome(t: { after: (fn: () => unknown) => void }) {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), 'persona-knowledge-'));
  process.env.HOME = home;
  t.after(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  });
  return home;
}

function knowledgeSkillPath(home: string, persona: string): string {
  return path.join(
    home,
    '.transcodes',
    'personas',
    persona,
    'skills',
    KNOWLEDGE_BASE_SKILL_NAME,
    'SKILL.md',
  );
}

function reference(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

test('knowledge file names are slugs of the title', () => {
  assert.equal(knowledgeFileSlug('Billing API'), 'billing-api');
  assert.equal(knowledgeFileSlug('  Pricing Table  '), 'pricing-table');
  assert.equal(knowledgeFileSlug('design_tokens'), 'design-tokens');
  assert.equal(knowledgeFileSlug('API.v2'), 'api-v2');
  assert.throws(() => knowledgeFileSlug('---'), /letter or number/);
});

test('Persona, Rule, and Skill names accept letters, numbers, dots, underscores, and hyphens', () => {
  assert.equal(assertPersonaId('Foo Bar'), 'Foo-Bar');
  assert.equal(assertPersonaName('rule', 'Quality Verification'), 'Quality-Verification');
  assert.equal(assertPersonaName('skill', 'prd-writing'), 'prd-writing');
  assert.equal(assertPersonaId('foo_bar'), 'foo_bar');
  assert.equal(assertPersonaId('billing.api'), 'billing.api');
  assert.equal(assertPersonaName('rule', 'design_tokens'), 'design_tokens');
  assert.equal(assertPersonaName('skill', 'DesignTokens'), 'DesignTokens');
  assert.throws(() => assertPersonaId('../escape'), /letters, numbers/);
  assert.throws(() => assertPersonaName('rule', 'bad name!'), /letters, numbers/);
});

test('frontmatter identifies a reference, and the file name is the fallback', () => {
  assert.deepEqual(
    knowledgeReferenceIdentity(
      'references/api.md',
      reference('Billing API', 'Endpoints and error codes', '# Knowledge'),
    ),
    {
      file: 'references/api.md',
      name: 'Billing API',
      description: 'Endpoints and error codes',
    },
  );

  assert.deepEqual(
    knowledgeReferenceIdentity('references/pricing-table.md', '# Knowledge\n'),
    {
      file: 'references/pricing-table.md',
      name: 'pricing-table',
      description: '',
    },
  );

  // A description spread over several lines still has to fit one bullet.
  assert.equal(
    knowledgeReferenceIdentity(
      'references/api.md',
      '---\nname: API\ndescription: >\n  first line\n  second line\n---\n',
    ).description,
    'first line second line',
  );
});

test('a new Persona ships with the knowledge-base Skill but stays uninitialized', async (t) => {
  const home = await isolatedHome(t);
  await createPersona('kb-new');

  const skill = await readFile(knowledgeSkillPath(home, 'kb-new'), 'utf8');
  assert.match(skill, /^name: knowledge-base$/m);
  assert.match(skill, /^description: Stores all knowledge/m);
  assert.match(skill, /If no reference matches, say that this is not in the Knowledge Base/);
  assert.match(skill, /lowercase kebab-case plus `\.md`/);
  assert.match(skill, /no project-specific claim was guessed/);

  const listing = await listPersona(undefined, 'kb-new');
  assert.equal(listing.knowledge.exists, true);
  assert.deepEqual(
    listing.knowledge.references.map((entry) => entry.file),
    [`references/${KNOWLEDGE_BASE_STARTER_NAME}.md`],
  );
  assert.match(
    listing.knowledge.references[0]?.description ?? '',
    /before adding a knowledge document/,
  );

  // The generated Skill and its starter document must not stand in for
  // authored content: an empty bundle still has nothing worth applying.
  await deletePersonaFile({ persona: 'kb-new', kind: 'agent' });
  const emptied = await listPersona(undefined, 'kb-new');
  assert.equal(emptied.knowledge.exists, true);
  assert.deepEqual(
    emptied.skills.map((entry) => entry.name),
    [KNOWLEDGE_BASE_SKILL_NAME],
  );
  assert.equal(emptied.initialized, false);
});

test('listing upgrades knowledge-base Steps and Output to the current guidance', async (t) => {
  const home = await isolatedHome(t);
  await createPersona('kb-upgrade');
  const skillPath = knowledgeSkillPath(home, 'kb-upgrade');
  const previous = await readFile(skillPath, 'utf8');
  const outdated = previous
    .replace(
      /# Steps[\s\S]*?(?=# Output)/,
      '# Steps\n1. Old step only.\n\n',
    )
    .replace(
      /# Output[\s\S]*$/,
      '# Output\n**Deliverable** — old\n',
    );
  await writeFile(skillPath, outdated);
  await listPersona(undefined, 'kb-upgrade');
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /If no reference matches, say that this is not in the Knowledge Base/);
  assert.match(skill, /lowercase kebab-case plus `\.md`/);
  assert.match(skill, /no project-specific claim was guessed/);
  assert.doesNotMatch(skill, /Old step only/);
});

test('knowledge references are indexed as name — description — path', async (t) => {
  const home = await isolatedHome(t);
  await createPersona('kb-index');
  const skillPath = knowledgeSkillPath(home, 'kb-index');

  await savePersonaFile({
    persona: 'kb-index',
    kind: 'skill',
    name: KNOWLEDGE_BASE_SKILL_NAME,
    file: 'references/billing-api.md',
    content: reference(
      'Billing API',
      'Endpoints, error codes, and retry rules',
      '# Knowledge\n- POST /charges is idempotent per key',
    ),
  });

  let skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /^# References$/m);
  assert.match(
    skill,
    /^- Billing API — Endpoints, error codes, and retry rules — \.\/references\/billing-api\.md$/m,
  );
  assert.ok(skill.indexOf('# References') < skill.indexOf('# Output'));

  // Editing the frontmatter rewrites the existing line instead of adding one.
  await savePersonaFile({
    persona: 'kb-index',
    kind: 'skill',
    name: KNOWLEDGE_BASE_SKILL_NAME,
    file: 'references/billing-api.md',
    content: reference(
      'Billing',
      'Charge lifecycle only',
      '# Knowledge\n- POST /charges is idempotent per key',
    ),
  });
  skill = await readFile(skillPath, 'utf8');
  assert.equal(skill.match(/references\/billing-api\.md/g)?.length, 1);
  assert.match(
    skill,
    /^- Billing — Charge lifecycle only — \.\/references\/billing-api\.md$/m,
  );

  // Agent/CLI writes must provide both fields so the generated index is useful.
  await assert.rejects(
    savePersonaFile({
      persona: 'kb-index',
      kind: 'skill',
      name: KNOWLEDGE_BASE_SKILL_NAME,
      file: 'references/glossary.md',
      content: '# Knowledge\n- MRR means monthly recurring revenue\n',
    }),
    /requires non-empty name and description frontmatter/,
  );
  await savePersonaFile({
    persona: 'kb-index',
    kind: 'skill',
    name: KNOWLEDGE_BASE_SKILL_NAME,
    file: 'references/glossary.md',
    content: reference(
      'Glossary',
      'Business and product terms',
      '# Knowledge\n- MRR means monthly recurring revenue',
    ),
  });
  skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /^- Glossary — Business and product terms/m);

  const listing = await listPersona(undefined, 'kb-index');
  assert.deepEqual(
    listing.knowledge.references.map((entry) => entry.name),
    ['Billing', 'Glossary', 'What belongs in Knowledge Base'],
  );

  await deleteSkillPath({
    persona: 'kb-index',
    name: KNOWLEDGE_BASE_SKILL_NAME,
    path: 'references/billing-api.md',
  });
  skill = await readFile(skillPath, 'utf8');
  assert.doesNotMatch(skill, /billing-api/);
  assert.match(skill, /^- Glossary — /m);

  await deleteSkillPath({
    persona: 'kb-index',
    name: KNOWLEDGE_BASE_SKILL_NAME,
    path: 'references/glossary.md',
  });
  skill = await readFile(skillPath, 'utf8');
  assert.doesNotMatch(skill, /glossary/);
  assert.match(skill, /^# References$/m);
  assert.match(
    skill,
    /^- What belongs in Knowledge Base — .+ — \.\/references\/what-belongs-here\.md$/m,
  );
});

test('listing fully reconciles direct reference edits and deletes without rewriting other sections', async (t) => {
  const home = await isolatedHome(t);
  await createPersona('kb-direct');
  const skillPath = knowledgeSkillPath(home, 'kb-direct');
  const referencePath = path.join(
    path.dirname(skillPath),
    'references',
    'design-style.md',
  );

  await writeFile(
    referencePath,
    reference('Design Style', 'Initial design guidance', '# Knowledge\n- Blue'),
  );
  await listPersona(undefined, 'kb-direct');
  let skill = await readFile(skillPath, 'utf8');
  assert.match(
    skill,
    /^- Design Style — Initial design guidance — \.\/references\/design-style\.md$/m,
  );

  skill = skill.replace(
    '# Steps',
    '# Team notes\nKeep this hand-written section.\n\n# Steps',
  );
  await writeFile(skillPath, skill);
  await writeFile(
    referencePath,
    reference('Visual System', 'Updated colors and typography', '# Knowledge\n- Red'),
  );
  await listPersona(undefined, 'kb-direct');
  skill = await readFile(skillPath, 'utf8');
  assert.match(
    skill,
    /^- Visual System — Updated colors and typography — \.\/references\/design-style\.md$/m,
  );
  assert.match(skill, /# Team notes\nKeep this hand-written section\./);
  assert.doesNotMatch(skill, /Initial design guidance/);

  await rm(referencePath);
  await listPersona(undefined, 'kb-direct');
  skill = await readFile(skillPath, 'utf8');
  assert.doesNotMatch(skill, /design-style\.md/);
  assert.match(
    skill,
    /^- What belongs in Knowledge Base — .+ — \.\/references\/what-belongs-here\.md$/m,
  );
  assert.match(skill, /# Team notes\nKeep this hand-written section\./);
});

test('the reserved knowledge-base Skill only accepts reference Markdown files', async (t) => {
  const home = await isolatedHome(t);
  await createPersona('kb-guard');
  const skillRoot = path.dirname(knowledgeSkillPath(home, 'kb-guard'));

  await assert.rejects(
    savePersonaFile({
      persona: 'kb-guard',
      kind: 'skill',
      name: KNOWLEDGE_BASE_SKILL_NAME,
      content: '# replacement\n',
    }),
    /managed automatically and cannot be saved directly/,
  );
  await assert.rejects(
    savePersonaFile({
      persona: 'kb-guard',
      kind: 'skill',
      name: KNOWLEDGE_BASE_SKILL_NAME,
      file: 'scripts/index.ts',
      content: 'console.log("no")\n',
    }),
    /only allows Markdown files under references\//,
  );
  await assert.rejects(
    savePersonaBatch({
      persona: 'kb-guard',
      changes: [
        {
          bundlePath: `skills/${KNOWLEDGE_BASE_SKILL_NAME}/scripts/extract.py`,
          bytes: Buffer.from('print("no")\n'),
        },
      ],
    }),
    /Markdown files under references\//,
  );
  assert.throws(
    () =>
      assertKnowledgeBaseBundleFiles([
        {
          name: KNOWLEDGE_BASE_SKILL_NAME,
          path: `skills/${KNOWLEDGE_BASE_SKILL_NAME}/SKILL.md`,
        },
        {
          name: KNOWLEDGE_BASE_SKILL_NAME,
          path: `skills/${KNOWLEDGE_BASE_SKILL_NAME}/references/notes.pdf`,
        },
        {
          name: KNOWLEDGE_BASE_SKILL_NAME,
          path: `skills/${KNOWLEDGE_BASE_SKILL_NAME}/scripts/extract.py`,
        },
      ]),
    /must be Markdown \(\.md\)[\s\S]*notes\.pdf[\s\S]*extract\.py/,
  );
  assert.doesNotThrow(() =>
    assertKnowledgeBaseBundleFiles([
      {
        name: KNOWLEDGE_BASE_SKILL_NAME,
        path: `skills/${KNOWLEDGE_BASE_SKILL_NAME}/SKILL.md`,
      },
      {
        name: KNOWLEDGE_BASE_SKILL_NAME,
        path: `skills/${KNOWLEDGE_BASE_SKILL_NAME}/references/billing-api.md`,
      },
      { name: 'pdf', path: 'skills/pdf/scripts/extract.py' },
    ]),
  );

  await mkdir(path.join(skillRoot, 'scripts'), { recursive: true });
  await writeFile(path.join(skillRoot, 'scripts', 'extract.py'), 'print("no")\n');
  const collected = await collectPersonaFiles('kb-guard');
  await assert.rejects(
    async () => assertKnowledgeBaseBundleFiles(collected),
    /must be Markdown \(\.md\)[\s\S]*extract\.py/,
  );
  await assert.rejects(
    savePersonaFile({
      persona: 'kb-guard',
      kind: 'skill',
      name: KNOWLEDGE_BASE_SKILL_NAME,
      file: 'references/DesignTokens.md',
      content: reference('Design tokens', 'Read before choosing a color', '# Knowledge\n- Blue'),
    }),
    /lowercase kebab-case/,
  );
  await assert.rejects(
    savePersonaFile({
      persona: 'kb-guard',
      kind: 'skill',
      name: KNOWLEDGE_BASE_SKILL_NAME,
      file: 'references/design_tokens.md',
      content: reference('Design tokens', 'Read before choosing a color', '# Knowledge\n- Blue'),
    }),
    /lowercase kebab-case/,
  );
  await assert.rejects(
    createSkillFolder({
      persona: 'kb-guard',
      name: KNOWLEDGE_BASE_SKILL_NAME,
      dir: 'assets',
    }),
    /managed automatically/,
  );
  await assert.rejects(
    deleteSkillPath({
      persona: 'kb-guard',
      name: KNOWLEDGE_BASE_SKILL_NAME,
      path: 'references',
    }),
    /only allows Markdown files under references\//,
  );
  await assert.rejects(
    deletePersonaFile({
      persona: 'kb-guard',
      kind: 'skill',
      name: KNOWLEDGE_BASE_SKILL_NAME,
    }),
    /cannot be deleted directly/,
  );

  // Simulate an older Persona with no knowledge-base. The first CLI reference
  // save restores the system Skill and its generated index automatically.
  await rm(skillRoot, { recursive: true, force: true });
  await savePersonaFile({
    persona: 'kb-guard',
    kind: 'skill',
    name: KNOWLEDGE_BASE_SKILL_NAME,
    file: 'references/design.md',
    content: reference(
      'Design',
      'Read for visual conventions',
      '# Knowledge\n- Use blue',
    ),
  });
  const restored = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(restored, /^name: knowledge-base$/m);
  assert.match(
    restored,
    /^- Design — Read for visual conventions — \.\/references\/design\.md$/m,
  );
});

test('quoted YAML special characters survive save and the generated index', async (t) => {
  const home = await isolatedHome(t);
  await createPersona('kb-yaml');

  await savePersonaFile({
    persona: 'kb-yaml',
    kind: 'skill',
    name: KNOWLEDGE_BASE_SKILL_NAME,
    file: 'references/internal.md',
    content: [
      '---',
      `name: ${JSON.stringify('API: v2')}`,
      `description: ${JSON.stringify('Read this when you need [internal] codes')}`,
      '---',
      '',
      '# Knowledge',
      '- 403 means quota',
      '',
    ].join('\n'),
  });

  const listing = await listPersona(undefined, 'kb-yaml');
  assert.deepEqual(
    listing.knowledge.references.filter(
      (entry) => entry.file === 'references/internal.md',
    ),
    [
      {
        file: 'references/internal.md',
        name: 'API: v2',
        description: 'Read this when you need [internal] codes',
      },
    ],
  );
  const skill = await readFile(knowledgeSkillPath(home, 'kb-yaml'), 'utf8');
  assert.match(
    skill,
    /^- API: v2 — Read this when you need \[internal\] codes — \.\/references\/internal\.md$/m,
  );
});

test('other Skills keep the hint-form reference bullets', async (t) => {
  const home = await isolatedHome(t);
  await createPersona('kb-scope');
  await savePersonaFile({
    persona: 'kb-scope',
    kind: 'skill',
    name: 'research',
    content:
      '---\nname: research\ndescription: Research a topic\n---\n\n# Steps\n1. Read\n\n# Output\n**Deliverable** — a report\n',
  });
  await savePersonaFile({
    persona: 'kb-scope',
    kind: 'skill',
    name: 'research',
    file: 'references/Sources.md',
    content: reference('Sources', 'Where to look', '# Knowledge'),
  });
  await savePersonaFile({
    persona: 'kb-scope',
    kind: 'skill',
    name: 'research',
    file: 'references/sources.md',
    content: reference('Sources', 'Where to look', '# Knowledge'),
  });

  const skill = await readFile(
    path.join(
      home,
      '.transcodes',
      'personas',
      'kb-scope',
      'skills',
      'research',
      'SKILL.md',
    ),
    'utf8',
  );
  assert.match(skill, /`references\/Sources\.md` — read this from the Step/);
  assert.doesNotMatch(skill, /— \.\/references/);
});
