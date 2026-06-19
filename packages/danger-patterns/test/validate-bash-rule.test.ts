/**
 * validateNewToolRule — bash (remote pattern) branch.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ToolRuleValidationError,
  validateNewToolRule,
} from '../src/tool-rules.js';

describe('validateNewToolRule bash type', () => {
  it('accepts a valid bash rule with regex in name', () => {
    const rule = validateNewToolRule({
      id: 'custom-rm-rf',
      type: 'bash',
      label: 'Block rm -rf',
      description: 'destructive recursive delete',
      name: 'rm\\s+-rf\\s+/',
      action: 'delete',
      resource: 'system',
    });
    assert.equal(rule.type, 'bash');
    assert.equal(rule.matcher, 'regex');
    assert.equal(rule.name, 'rm\\s+-rf\\s+/');
    assert.equal(rule.action, 'delete');
    assert.equal(rule.resource, 'system');
  });

  it('rejects invalid regex in name', () => {
    assert.throws(
      () =>
        validateNewToolRule({
          id: 'bad-regex',
          type: 'bash',
          label: 'Bad',
          description: 'bad pattern',
          name: '[unclosed',
          action: 'delete',
          resource: 'system',
        }),
      ToolRuleValidationError,
    );
  });

  it('rejects bash rule without action/resource', () => {
    assert.throws(
      () =>
        validateNewToolRule({
          id: 'no-action',
          type: 'bash',
          label: 'Missing action',
          description: 'needs action and resource',
          name: 'curl\\s+',
        }),
      ToolRuleValidationError,
    );
    assert.throws(
      () =>
        validateNewToolRule({
          id: 'no-resource',
          type: 'bash',
          label: 'Missing resource',
          description: 'needs resource',
          name: 'curl\\s+',
          action: 'read',
        }),
      ToolRuleValidationError,
    );
  });

  it('rejects non-regex matcher for bash', () => {
    assert.throws(
      () =>
        validateNewToolRule({
          id: 'wrong-matcher',
          type: 'bash',
          label: 'Wrong matcher',
          description: 'must be regex',
          name: 'curl',
          matcher: 'exact',
          action: 'read',
          resource: 'system',
        }),
      ToolRuleValidationError,
    );
  });

  it('does not match bash rules as MCP tool names', async () => {
    const { toolNameMatchesRule } = await import('../src/tool-rules.js');
    const bashRule = validateNewToolRule({
      id: 'bash-only',
      type: 'bash',
      label: 'Bash',
      description: 'shell only',
      name: 'rm\\s+-rf',
      action: 'delete',
      resource: 'system',
    });
    assert.equal(toolNameMatchesRule('rm -rf /', bashRule), false);
  });
});
