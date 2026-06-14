/**
 * Tool-name matching is case-insensitive — hosts emit mixed-case wire names
 * (e.g. mcp__claude_ai_Google_Calendar__create_event).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findFirstToolRule,
  type MergedToolRule,
  mcpConsumesInHook,
  type ToolRule,
  toolNameMatchesRule,
} from '../src/tool-rules.js';

const exactRule: ToolRule = {
  id: 'gcal-create',
  type: 'mcp',
  label: 'Google Calendar create',
  description: 'step-up before creating events',
  name: 'mcp__claude_ai_Google_Calendar__create_event',
  matcher: 'exact',
};

const globRule: ToolRule = {
  id: 'gcal-all',
  type: 'mcp',
  label: 'Google Calendar all',
  description: 'step-up for any calendar tool',
  name: 'mcp__claude_ai_Google_Calendar__*',
  matcher: 'glob',
};

describe('mcpConsumesInHook', () => {
  it('defaults bundle rules to hook consume (fp-keyed path)', () => {
    assert.equal(
      mcpConsumesInHook({
        ...exactRule,
        source: 'bundle',
      }),
      true,
    );
  });

  it('defaults system rules to deferred handler consume (GLOBAL path)', () => {
    assert.equal(
      mcpConsumesInHook({
        ...exactRule,
        source: 'system',
      }),
      false,
    );
  });

  it('honours explicit consume_in_hook override', () => {
    assert.equal(
      mcpConsumesInHook({
        ...exactRule,
        source: 'system',
        consume_in_hook: true,
      }),
      true,
    );
  });
});

describe('toolNameMatchesRule case-insensitivity', () => {
  it('matches exact rule regardless of casing', () => {
    assert.equal(
      toolNameMatchesRule(
        'mcp__claude_ai_google_calendar__create_event',
        exactRule,
      ),
      true,
    );
    assert.equal(
      toolNameMatchesRule(
        'MCP__CLAUDE_AI_GOOGLE_CALENDAR__CREATE_EVENT',
        exactRule,
      ),
      true,
    );
  });

  it('matches glob rule regardless of casing', () => {
    assert.equal(
      toolNameMatchesRule(
        'mcp__claude_ai_google_calendar__delete_event',
        globRule,
      ),
      true,
    );
  });

  it('does not match a different tool', () => {
    assert.equal(
      toolNameMatchesRule('mcp__github__delete_repository', exactRule),
      false,
    );
  });

  it('findFirstToolRule resolves mixed-case wire name', () => {
    const rules: MergedToolRule[] = [{ ...exactRule, source: 'bundle' }];
    const match = findFirstToolRule(
      'mcp__claude_ai_Google_Calendar__create_event',
      rules,
    );
    assert.equal(match?.matched.id, 'gcal-create');
  });
});
