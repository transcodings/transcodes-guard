import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bundleContentHash,
  personaSyncGuidance,
  planPull,
  sha256Hex,
} from '../src/commands/transcodes/persona-sync.js';

test('planPull: differing or missing digests download, equal ones stay, extras are local_only', () => {
  const plan = planPull(
    [
      { path: 'instruction/agents.md', sha256: 'h1' },
      { path: 'rules/tone.md', sha256: 'h2' },
      { path: 'skills/research/SKILL.md', sha256: 'h3' },
    ],
    [
      { path: 'instruction/agents.md', sha256: 'h1' },
      { path: 'rules/tone.md', sha256: 'edited-locally' },
      { path: 'rules/only-here.md', sha256: 'h4' },
    ],
  );
  assert.deepEqual(plan.unchanged, ['instruction/agents.md']);
  assert.deepEqual(plan.download, [
    'rules/tone.md',
    'skills/research/SKILL.md',
  ]);
  assert.deepEqual(plan.localOnly, ['rules/only-here.md']);
});

test('planPull: a blank machine downloads the whole manifest', () => {
  const plan = planPull(
    [
      { path: 'instruction/agents.md', sha256: 'h1' },
      { path: 'rules/tone.md', sha256: 'h2' },
    ],
    [],
  );
  assert.deepEqual(plan.download, ['instruction/agents.md', 'rules/tone.md']);
  assert.deepEqual(plan.unchanged, []);
  assert.deepEqual(plan.localOnly, []);
});

test('bundleContentHash: order-independent, content- and path-sensitive', () => {
  const files = [
    { path: 'instruction/agents.md', sha256: 'h1' },
    { path: 'rules/tone.md', sha256: 'h2' },
  ];
  const reversed = [files[1], files[0]];
  assert.equal(bundleContentHash(files), bundleContentHash(reversed));
  assert.notEqual(
    bundleContentHash(files),
    bundleContentHash([files[0], { path: 'rules/tone.md', sha256: 'edited' }]),
  );
  assert.notEqual(
    bundleContentHash(files),
    bundleContentHash([files[0], { path: 'rules/other.md', sha256: 'h2' }]),
  );
});

test('sha256Hex: lowercase hex over raw bytes (NIST "abc" vector)', () => {
  assert.equal(
    sha256Hex(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('personaSyncGuidance: both 409 conflicts steer to pull, token/blob codes steer to push again', () => {
  for (const code of [
    'PERSONA_REVISION_MISMATCH',
    'PERSONA_MANIFEST_CONFLICT',
  ] as const) {
    const guidance = personaSyncGuidance('dev', code);
    assert.match(guidance ?? '', /pull --persona dev/);
    assert.match(guidance ?? '', /local files were not modified/);
  }
  for (const code of [
    'PERSONA_COMMIT_TOKEN_INVALID',
    'PERSONA_BLOB_NOT_UPLOADED',
  ] as const) {
    assert.match(personaSyncGuidance('dev', code) ?? '', /push --persona dev/);
  }
  assert.equal(personaSyncGuidance('dev', undefined), undefined);
});

test('personaSyncGuidance: tag/revision codes steer to persona log', () => {
  for (const code of [
    'PERSONA_TAG_ALREADY_EXISTS',
    'PERSONA_REVISION_NOT_FOUND',
  ] as const) {
    assert.match(personaSyncGuidance('dev', code) ?? '', /log --persona dev/);
  }
});
