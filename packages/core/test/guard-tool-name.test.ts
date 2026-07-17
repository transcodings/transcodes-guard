/**
 * isGuardToolName — exact-set replacement for the substring predicate
 * (toolgate t2 §2-a). Pins the fail direction: anything not literally ours
 * is NOT skipped.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { denyByDefaultBackend } from '../src/contract/noop.js';
import { GUARD_TOOL_NAMES, isGuardToolName } from '../src/patterns/tool-rules.js';
import { coreToolDefinitions } from '../src/server/tool-definitions.js';

// GUARD_TOOL_NAMES is generated from the definition data; the full 1:1 union
// drift guard lives in packages/gate-backend/test/tool-definitions.test.ts
// (it can see both definition arrays). Here: the core subset only.
describe('GUARD_TOOL_NAMES drift guard (core subset)', () => {
  it('contains every core tool definition name', () => {
    for (const def of coreToolDefinitions(denyByDefaultBackend)) {
      assert.equal(GUARD_TOOL_NAMES.has(def.name), true, def.name);
    }
  });
});

describe('isGuardToolName', () => {
  it('accepts every registered name, bare and host-wrapped', () => {
    for (const name of GUARD_TOOL_NAMES) {
      assert.equal(isGuardToolName(name), true, name);
      assert.equal(
        isGuardToolName(`mcp__plugin_mcp_plugin_transcodes_guard__${name}`),
        true,
        `wrapped ${name}`,
      );
      assert.equal(
        isGuardToolName(`mcp__mcp_plugin_transcodes_guard__${name}`),
        true,
        `bare-ns wrapped ${name}`,
      );
    }
  });

  it('deadlock direction: the step-up recovery poll tool always skips', () => {
    assert.equal(isGuardToolName('tc_poll_stepup_session_wait'), true);
    assert.equal(
      isGuardToolName(
        'mcp__plugin_mcp_plugin_transcodes_guard__tc_poll_stepup_session_wait',
      ),
      true,
    );
  });

  it('rejects substring look-alikes the old predicate wrongly skipped', () => {
    assert.equal(isGuardToolName('get_utc_time'), false);
    assert.equal(isGuardToolName('btc_transfer'), false);
    assert.equal(isGuardToolName('publish_version'), false);
    assert.equal(isGuardToolName('my_transcodes_adapter'), false);
    assert.equal(isGuardToolName('mcp__acme__sync_version'), false);
  });

  it('rejects our tool name under a foreign namespace (impersonation)', () => {
    assert.equal(isGuardToolName('mcp__some_other_server__tc_get_member'), false);
    assert.equal(isGuardToolName('mcp__mongodb__list'), false);
  });

  it('rejects a foreign name under our namespace shape', () => {
    assert.equal(
      isGuardToolName('mcp__plugin_mcp_plugin_transcodes_guard__tc_not_registered'),
      false,
    );
  });

  it('rejects bare non-registered names (fail-safe default)', () => {
    assert.equal(isGuardToolName('get_member'), false);
    assert.equal(isGuardToolName(''), false);
  });
});
