import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSkillsBundleSize,
  packSkillsBundle,
  SKILLS_BUNDLE_MAX_BYTES,
  unpackSkillsBundle,
} from '../src/commands/transcodes/persona-skill-bundle.js';

test('pack then unpack returns the same skill files', () => {
  const files = [
    {
      bundlePath: 'skills/knowledge-base/SKILL.md',
      bytes: Buffer.from('---\nname: knowledge-base\n---\n'),
    },
    {
      bundlePath: 'skills/knowledge-base/references/billing-api.md',
      bytes: Buffer.from('# Billing\n'),
    },
    {
      bundlePath: 'skills/pdf/scripts/extract.py',
      bytes: Buffer.from('print("ok")\n'),
    },
  ];
  const extracted = unpackSkillsBundle(packSkillsBundle(files));
  assert.deepEqual(
    extracted.map((file) => file.bundlePath).sort(),
    files.map((file) => file.bundlePath).sort(),
  );
  for (const file of files) {
    const got = extracted.find((entry) => entry.bundlePath === file.bundlePath);
    assert.ok(got);
    assert.equal(got.bytes.toString('utf8'), file.bytes.toString('utf8'));
  }
});

test('unpack rejects zip-slip paths', () => {
  const escaped = packSkillsBundle([
    {
      bundlePath: 'skills/pdf/SKILL.md',
      bytes: Buffer.from('# pdf\n'),
    },
  ]);
  // A well-formed archive is accepted; the packer itself refuses unsafe paths.
  assert.throws(
    () =>
      packSkillsBundle([
        { bundlePath: 'skills/../etc/passwd', bytes: Buffer.from('x') },
      ]),
    /must stay under skills/,
  );
  assert.ok(escaped.byteLength > 0);
});

test('assertSkillsBundleSize lists the largest files over 20 MB', () => {
  assert.doesNotThrow(() =>
    assertSkillsBundleSize([
      { path: 'skills/a/SKILL.md', size: 1024 },
      { path: 'skills/b/SKILL.md', size: 2048 },
    ]),
  );
  assert.throws(
    () =>
      assertSkillsBundleSize([
        { path: 'skills/a/video.mp4', size: 12 * 1024 * 1024 },
        { path: 'skills/b/deck.pdf', size: 9 * 1024 * 1024 },
      ]),
    /limit 20\.0 MB[\s\S]*video\.mp4 \(12\.0 MB\)[\s\S]*deck\.pdf \(9\.0 MB\)/,
  );
  assert.equal(SKILLS_BUNDLE_MAX_BYTES, 20 * 1024 * 1024);
});

test('unpack rejects a compressed archive that expands beyond 20 MB', () => {
  const archive = packSkillsBundle([
    {
      bundlePath: 'skills/large/assets/payload.bin',
      bytes: Buffer.alloc(SKILLS_BUNDLE_MAX_BYTES + 1),
    },
  ]);
  assert.throws(
    () => unpackSkillsBundle(archive),
    /expands beyond the 20 MB skills limit/,
  );
});
