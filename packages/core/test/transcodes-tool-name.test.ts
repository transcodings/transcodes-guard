import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTranscodesGuardWireToolName } from '../src/patterns/tool-rules.js';

describe('transcodes guard tool names', () => {
  it('bypasses canonical and host-wrapped names', () => {
    assert.equal(
      isTranscodesGuardWireToolName('tc_poll_stepup_session_wait'),
      true,
    );
    assert.equal(
      isTranscodesGuardWireToolName(
        'mcp__plugin_mcp_plugin_transcodes_guard__tc_get_member',
      ),
      true,
    );
    assert.equal(isTranscodesGuardWireToolName('mcp__mongodb__list'), false);
    assert.equal(isTranscodesGuardWireToolName('get_member'), false);
  });
});
