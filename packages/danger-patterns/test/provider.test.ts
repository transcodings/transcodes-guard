/**
 * Optional provider field — validation and persistence shape only (no matching).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateNewToolRule } from '../src/tool-rules.js';

describe('validateNewToolRule provider', () => {
  const base = {
    id: 'scoped',
    label: 'Scoped',
    description: 'provider metadata',
    name: 'mcp__example__tool',
  };

  it('accepts a valid provider slug', () => {
    const rule = validateNewToolRule({ ...base, provider: 'cursor' });
    assert.equal(rule.provider, 'cursor');
  });

  it('omits provider when not set', () => {
    const rule = validateNewToolRule(base);
    assert.equal(rule.provider, undefined);
  });

  it('rejects an unknown provider', () => {
    assert.throws(
      () => validateNewToolRule({ ...base, provider: 'unknown' as 'cursor' }),
      /provider must be one of/,
    );
  });
});
