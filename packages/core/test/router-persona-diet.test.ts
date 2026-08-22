import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TRANSCODES_ROUTER_BODY } from '../src/server/router-body.js';

test('Persona Diet keeps its safety contract', () => {
  for (const clause of [
    'Require the user to name the exact Persona.',
    'continue only if it lists `--batch-file`',
    'Inventory every companion path',
    'Check the current official documentation',
    'the whole approved bundle succeeds or leaves the Persona unchanged',
    'Deploy only if the user separately asks',
  ]) {
    assert.ok(TRANSCODES_ROUTER_BODY.includes(clause), clause);
  }
  assert.ok(
    TRANSCODES_ROUTER_BODY.includes('Do not impose a universal line or token target'),
  );
  assert.ok(
    TRANSCODES_ROUTER_BODY.includes('Read a reference only when its SKILL.md states'),
  );
});

test('generated host Skills expose the Diet trigger', () => {
  for (const file of [
    '../../../plugins/claude-code/skills/transcodes/SKILL.md',
    '../../../plugins/cursor/skills/transcodes/SKILL.md',
    '../../../plugins/codex/skills/transcodes/SKILL.md',
    '../../../plugins/antigravity/skills/transcodes/SKILL.md',
  ]) {
    assert.match(
      readFileSync(new URL(file, import.meta.url), 'utf8'),
      /^description:.*optimize, simplify, or Diet a Persona/m,
    );
  }
});
