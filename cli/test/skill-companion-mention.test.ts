import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPersona,
  deleteSkillPath,
  mentionSkillCompanions,
  savePersonaFile,
} from '../src/commands/transcodes/persona.js';

const BASE = `---
name: pdf
description: Extract text from a PDF
---

# Prerequisites
- A PDF file

# Steps
1. Inspect the file
2. Extract the text

# Output
**Deliverable** — extracted text
**Done when** — the text is readable
`;

test('adds a scripts section with the real file name', () => {
  const next = mentionSkillCompanions(BASE, ['scripts/extract.py']);
  assert.match(next, /^# Available scripts$/m);
  assert.match(
    next,
    /`scripts\/extract\.py` — run `python3 scripts\/extract\.py` from the Step that needs it; do not hand-write that work/,
  );
  assert.match(next, /^# Output$/m);
  assert.ok(next.indexOf('# Available scripts') < next.indexOf('# Output'));
});

test('does not rewrite Steps when listing a companion', () => {
  const next = mentionSkillCompanions(BASE, [
    'scripts/extract.py',
    'references/billing-api.md',
  ]);
  const start = next.search(/^# Steps\s*$/m);
  const rest = next.slice(start + '# Steps'.length);
  const end = rest.search(/^# /m);
  const steps = next.slice(start, start + '# Steps'.length + end);
  assert.match(steps, /1\. Inspect the file/);
  assert.match(steps, /2\. Extract the text/);
  assert.doesNotMatch(steps, /scripts\/extract\.py/);
  assert.doesNotMatch(steps, /references\/billing-api\.md/);
});

test('names the interpreter that matches the script extension', () => {
  const node = mentionSkillCompanions(BASE, ['scripts/generate-dto.js']);
  assert.match(node, /run `node scripts\/generate-dto\.js`/);
  const bash = mentionSkillCompanions(BASE, ['scripts/sync.sh']);
  assert.match(bash, /run `bash scripts\/sync\.sh`/);
  const bare = mentionSkillCompanions(BASE, ['scripts/tool']);
  assert.match(bare, /run `scripts\/tool`/);
});

test('adds a references section with the real file name', () => {
  const next = mentionSkillCompanions(BASE, ['references/billing-api.md']);
  assert.match(next, /^# References$/m);
  assert.match(
    next,
    /`references\/billing-api\.md` — read this from the Step that needs it; do not guess what it contains/,
  );
});

test('rewrites a bullet written by an older CLI version', () => {
  const legacy = BASE.replace(
    '# Output',
    `# Available scripts
- \`scripts/extract.py\` — run this when the workflow needs this helper

# Output`,
  );
  const next = mentionSkillCompanions(legacy, ['scripts/extract.py']);
  assert.match(next, /run `python3 scripts\/extract\.py` from the Step/);
  assert.doesNotMatch(next, /run this when the workflow needs this helper/);
  assert.equal(next.match(/^- `scripts\/extract\.py`/gm)?.length, 1);
});

test('drops a legacy bullet whose companion is gone', () => {
  const legacy = BASE.replace(
    '# Output',
    `# References
- \`references/billing-api.md\` — read this when you need the detailed reference

# Output`,
  );
  const next = mentionSkillCompanions(legacy, []);
  assert.doesNotMatch(next, /references\/billing-api\.md/);
  assert.doesNotMatch(next, /^# References$/m);
});

test('does not duplicate a file that is already listed', () => {
  const listed = mentionSkillCompanions(BASE, ['scripts/extract.py']);
  const again = mentionSkillCompanions(listed, ['scripts/extract.py']);
  assert.equal(
    listed.split('scripts/extract.py').length,
    again.split('scripts/extract.py').length,
  );
});

test('replaces the directory placeholder with the real file', () => {
  const withPlaceholder = BASE.replace(
    '# Output',
    `# Available scripts
- \`scripts/\` — <each script: what it does and when to run it>

# Output`,
  );
  const next = mentionSkillCompanions(withPlaceholder, ['scripts/extract.py']);
  assert.doesNotMatch(next, /`scripts\/` —/);
  assert.match(next, /`scripts\/extract\.py`/);
});

test('ignores SKILL.md, assets, and gitkeep', () => {
  const next = mentionSkillCompanions(BASE, [
    'SKILL.md',
    'assets/icon.png',
    'scripts/.gitkeep',
  ]);
  assert.doesNotMatch(next, /# Available scripts/);
  assert.doesNotMatch(next, /# References/);
});

test('keeps an existing custom bullet when adding another script', () => {
  const withCustom = BASE.replace(
    '# Output',
    `# Available scripts
- \`scripts/tables.py\` — extract tables from the PDF

# Output`,
  );
  const next = mentionSkillCompanions(withCustom, [
    'scripts/tables.py',
    'scripts/extract.py',
  ]);
  assert.match(next, /`scripts\/tables\.py` — extract tables from the PDF/);
  assert.match(next, /`scripts\/extract\.py` — run `python3 scripts\/extract\.py`/);
  assert.equal(next.split('scripts/tables.py').length, 2);
});

test('does not treat an HTML-comment example path as a real mention', () => {
  const withComment = `${BASE}
<!-- e.g. "Read references/billing-api.md when ..." -->
`;
  const next = mentionSkillCompanions(withComment, [
    'references/billing-api.md',
  ]);
  assert.match(next, /^# References$/m);
  assert.match(next, /`references\/billing-api\.md`/);
});

test('matches exact paths rather than filename prefixes', () => {
  const withBackup = BASE.replace(
    '# Output',
    `# Available scripts
- \`scripts/extract.py.bak\` — keep the old implementation for comparison

# Output`,
  );
  const next = mentionSkillCompanions(withBackup, [
    'scripts/extract.py',
    'scripts/extract.py.bak',
  ]);
  assert.match(
    next,
    /`scripts\/extract\.py` — run `python3 scripts\/extract\.py` from the Step/,
  );
  assert.match(next, /`scripts\/extract\.py\.bak` — keep the old implementation/);
});

test('removes stale CLI-generated bullets when a companion is deleted', () => {
  const listed = mentionSkillCompanions(BASE, ['scripts/extract.py']);
  const afterDelete = mentionSkillCompanions(listed, []);
  assert.doesNotMatch(afterDelete, /scripts\/extract\.py/);
  assert.doesNotMatch(afterDelete, /^# Available scripts$/m);
  assert.match(afterDelete, /^# Output$/m);
});

test('preserves custom bullets even when their file is no longer present', () => {
  const custom = BASE.replace(
    '# Output',
    `# Available scripts
- \`scripts/manual.py\` — custom guidance owned by the author

# Output`,
  );
  const afterDelete = mentionSkillCompanions(custom, []);
  assert.match(afterDelete, /`scripts\/manual\.py` — custom guidance/);
  assert.match(afterDelete, /^# Available scripts$/m);
});

test('save and delete keep the on-disk SKILL.md companion list synchronized', async (t) => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), 'persona-companion-'));
  process.env.HOME = home;
  t.after(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  await createPersona('companion-test');
  await assert.rejects(
    savePersonaFile({
      persona: 'companion-test',
      kind: 'skill',
      name: 'pdf',
      file: 'scripts/extract.py',
      content: 'print("extract")\n',
    }),
    /Save SKILL\.md before adding/,
  );

  const scriptPath = path.join(
    home,
    '.transcodes',
    'personas',
    'companion-test',
    'skills',
    'pdf',
    'scripts',
    'extract.py',
  );
  await assert.rejects(readFile(scriptPath));

  await savePersonaFile({
    persona: 'companion-test',
    kind: 'skill',
    name: 'pdf',
    content: BASE,
  });
  await savePersonaFile({
    persona: 'companion-test',
    kind: 'skill',
    name: 'pdf',
    file: 'scripts/extract.py',
    content: 'print("extract")\n',
  });

  const skillPath = path.join(
    home,
    '.transcodes',
    'personas',
    'companion-test',
    'skills',
    'pdf',
    'SKILL.md',
  );
  const saved = await readFile(skillPath, 'utf8');
  assert.match(saved, /`scripts\/extract\.py`/);
  assert.doesNotMatch(
    saved.slice(saved.indexOf('# Steps'), saved.indexOf('# Available scripts')),
    /scripts\/extract\.py/,
  );

  await deleteSkillPath({
    persona: 'companion-test',
    name: 'pdf',
    path: 'scripts/extract.py',
  });
  assert.doesNotMatch(await readFile(skillPath, 'utf8'), /scripts\/extract\.py/);

  await assert.rejects(
    savePersonaFile({
      persona: 'companion-test',
      kind: 'skill',
      name: 'pdf',
      file: 'references/guide.pdf',
      content: '%PDF-1.4\n',
    }),
    /Markdown/,
  );

  const strayPdf = path.join(
    home,
    '.transcodes',
    'personas',
    'companion-test',
    'skills',
    'pdf',
    'references',
    'guide.pdf',
  );
  await mkdir(path.dirname(strayPdf), { recursive: true });
  await writeFile(strayPdf, '%PDF-1.4\n');
  await deleteSkillPath({
    persona: 'companion-test',
    name: 'pdf',
    path: 'references/guide.pdf',
  });
  await assert.rejects(readFile(strayPdf));
});
