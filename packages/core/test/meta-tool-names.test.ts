/**
 * Meta mirror drift alarm (t5 §3) — the derived meta set must equal the
 * backend's `guard.meta-tools.ts` list EXACTLY. The double-safety design
 * (backend classifies drifting tc_* tools through the matrix instead of
 * allowing them by name) only holds while the two lists are identical;
 * `tc_create_stepup_session` is the one meta whose drift the matrix cannot
 * absorb (`transcodes/create=2` → creating a session would require a
 * session). The hardcoded list below IS the mirror of
 * transcode-backend-nestjs-v1 `src/guard/guard.meta-tools.ts` — change both
 * sides together, never one.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { denyByDefaultBackend } from '../src/contract/noop.js';
import {
  GUARD_META_TOOL_NAMES,
  GUARD_TOOL_NAMES,
} from '../src/patterns/tool-rules.js';
import { coreToolDefinitions } from '../src/server/tool-definitions.js';

const BACKEND_META_MIRROR = [
  'tc_create_stepup_session',
  'tc_inspect_stepup_state',
  'tc_poll_stepup_session',
  'tc_poll_stepup_session_wait',
];

describe('GUARD_META_TOOL_NAMES ↔ backend guard.meta-tools.ts drift alarm', () => {
  it('equals the backend meta list exactly (4 names, no more, no less)', () => {
    assert.deepEqual([...GUARD_META_TOOL_NAMES].sort(), BACKEND_META_MIRROR);
  });

  it('is a subset of the registered tool set', () => {
    for (const name of GUARD_META_TOOL_NAMES) {
      assert.equal(GUARD_TOOL_NAMES.has(name), true, name);
    }
  });

  it('matches the meta flags of the core definitions (meta lives only in core)', () => {
    const fromDefs = coreToolDefinitions(denyByDefaultBackend)
      .filter((def) => def.meta)
      .map((def) => def.name)
      .sort();
    assert.deepEqual(fromDefs, [...GUARD_META_TOOL_NAMES].sort());
  });
});
