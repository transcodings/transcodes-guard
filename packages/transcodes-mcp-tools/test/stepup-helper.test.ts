import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  loadMergedToolRules,
  type MergedToolRule,
} from '@transcodes-guard/danger-patterns';
import { resolveProtectedToolRule } from '../src/stepup-helper.js';

describe('step-up protected tool rule resolution', () => {
  it('matches the local handler name to the system MCP wire rule', () => {
    const rule = resolveProtectedToolRule('create_resource');

    assert.equal(rule?.id, 'tc-create-resource');
    assert.equal(rule?.resource, 'system');
    assert.equal(rule?.action, 'create');
  });

  it('still matches the full MCP wire name directly', () => {
    const rules = loadMergedToolRules();
    const rule = resolveProtectedToolRule(
      'mcp__plugin_transcodes-guard_transcodes-guard__create_resource',
      rules,
    );

    assert.equal(rule?.id, 'tc-create-resource');
  });

  it('does not match unrelated handler names', () => {
    const rule = resolveProtectedToolRule('unknown_tool');

    assert.equal(rule, undefined);
  });

  it('does not resolve local handler names from bundle rules', () => {
    const bundleRule: MergedToolRule = {
      id: 'external-create-resource',
      type: 'mcp',
      label: 'External create resource',
      description: 'External tool with the same suffix',
      name: 'mcp__external__server__create_resource',
      matcher: 'exact',
      action: 'create',
      resource: 'system',
      source: 'bundle',
    };

    const rule = resolveProtectedToolRule('create_resource', [bundleRule]);

    assert.equal(rule, undefined);
  });
});
