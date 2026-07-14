/**
 * isGuardToolName — exact-set replacement for the substring predicate
 * (toolgate t2 §2-a). Pins the fail direction: anything not literally ours
 * is NOT skipped.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Untyped repo script; the catalog is the hand-maintained mirror of every
// registerTool() call, so importing it turns this test into a drift guard
// between the catalog and GUARD_TOOL_NAMES.
// @ts-expect-error TS7016 — plain-JS script, no declaration file
import { MCP_TOOLS } from '../../../scripts/tool-catalog.mjs';
import { GUARD_TOOL_NAMES, isGuardToolName } from '../src/patterns/tool-rules.js';

describe('GUARD_TOOL_NAMES drift guard', () => {
  it('matches scripts/tool-catalog.mjs 1:1 (catalog stores bare names)', () => {
    const fromCatalog = new Set(
      (MCP_TOOLS as { name: string }[]).map((t) => `tc_${t.name}`),
    );
    assert.deepEqual([...GUARD_TOOL_NAMES].sort(), [...fromCatalog].sort());
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
