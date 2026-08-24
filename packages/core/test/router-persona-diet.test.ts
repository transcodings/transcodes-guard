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
    'Always ask these three choices in order',
    'Remove Transcodes MCP / do-not-bypass-via-Bash-or-shell Instruction lines',
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

test('Persona create/edit omits MCP instruction lines and always asks where to apply', () => {
  for (const clause of [
    'Do not add Transcodes MCP / do-not-bypass-via-Bash-or-shell lines',
    'If those lines are already in the Instruction, remove them on create, edit, or Diet',
    'ALWAYS ask whether to apply it now',
    'Never default to This device (Global)',
    'Offer exactly these three choices, in this order',
    'If no project folder is currently applied and no workspace path is known',
    'Do not treat "I don\'t know" as Global',
    'Never treat a missing project path as a Global apply',
  ]) {
    assert.ok(TRANSCODES_ROUTER_BODY.includes(clause), clause);
  }
  assert.ok(!TRANSCODES_ROUTER_BODY.includes('Deploy only if the user separately asks'));
  assert.ok(
    !TRANSCODES_ROUTER_BODY.includes(
      'If no project path was supplied, default to This device (Global)',
    ),
  );
});

test('Persona routing recognizes customer language without requiring the Persona term', () => {
  for (const clause of [
    'Trigger even when the user does not say "Persona"',
    'agent config, AI setup, AI settings, team rules, instructions, agent profile',
    '"set up my AI"',
    '"add our project rules"',
    '"apply our team conventions here"',
    '`AGENTS.md`, `CLAUDE.md`, Rules, or Skills as one AI configuration',
    'AI work settings (Persona), command/tool protection (Guard), or member permissions (RBAC)',
  ]) {
    assert.ok(TRANSCODES_ROUTER_BODY.includes(clause), clause);
  }
});

test('generated host Skills expose broad Persona and Diet triggers', () => {
  for (const file of [
    '../../../plugins/claude-code/skills/transcodes/SKILL.md',
    '../../../plugins/cursor/skills/transcodes/SKILL.md',
    '../../../plugins/codex/skills/transcodes/SKILL.md',
    '../../../plugins/antigravity/skills/transcodes/SKILL.md',
  ]) {
    const skill = readFileSync(new URL(file, import.meta.url), 'utf8');
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    assert.match(frontmatter, /^description: \|$/m);
    assert.match(frontmatter, /agent config, AI setup, team rules, instructions, agent profile/);
    assert.match(frontmatter, /review a Persona, Rule, or Skill/);
    assert.match(frontmatter, /Persona, Rule, Skill을 리뷰/);
    assert.match(frontmatter, /apply team standards to a project or folder/);
    assert.match(frontmatter, /Persona Diet/);
  }
});
