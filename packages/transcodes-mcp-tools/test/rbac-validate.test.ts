/**
 * RBAC resource key extraction — must match NestJS NormalizedResponse envelope.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { extractResourceKeys } from '../src/rbac-validate.js';

describe('extractResourceKeys', () => {
  it('reads keys from NestJS payload array', () => {
    const keys = extractResourceKeys({
      success: true,
      statusCode: 200,
      payload: [
        { id: '1', key: 'system', name: 'System' },
        { id: '2', key: 'revenue', name: 'Revenue' },
      ],
    });
    assert.deepEqual(keys.sort(), ['revenue', 'system']);
  });

  it('reads a bare resource array', () => {
    const keys = extractResourceKeys([{ key: 'system' }]);
    assert.deepEqual(keys, ['system']);
  });

  it('returns empty when envelope has no known array field', () => {
    assert.deepEqual(extractResourceKeys({ success: true, payload: [] }), []);
    assert.deepEqual(extractResourceKeys({ foo: [{ key: 'x' }] }), []);
  });
});
