import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudecodeRule } from '../src/commands/sync/features/rules/claudecode-rule.js';
import { RulesyncRule } from '../src/commands/sync/features/rules/rulesync-rule.js';

test('Claude root deploy copies the Instruction body into CLAUDE.md', () => {
  const body = 'You are a test persona.\n';
  const rule = ClaudecodeRule.fromRulesyncRule({
    rulesyncRule: new RulesyncRule({
      outputRoot: '/tmp',
      relativeDirPath: '.transcodes/agents',
      relativeFilePath: 'agents.md',
      frontmatter: { root: true, description: 'test', globs: ['**/*'] },
      body,
      validate: true,
    }),
  });

  assert.equal(rule.getRelativeFilePath(), 'CLAUDE.md');
  assert.equal(rule.getFileContent(), body);
  assert.doesNotMatch(rule.getFileContent(), /@AGENTS\.md/);
  assert.equal(ClaudecodeRule.getRootMirror, undefined);
});
