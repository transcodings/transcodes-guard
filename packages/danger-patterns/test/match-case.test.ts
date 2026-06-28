/**
 * Tool-name matching is case-insensitive — hosts emit mixed-case wire names
 * (e.g. mcp__claude_ai_Google_Calendar__create_event).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const codexAppsRule: ToolRule = {
  id: 'codex-gcal-create',
  type: 'mcp',
  label: 'Google Calendar create (Codex Apps)',
  description: 'step-up before creating events from Codex Apps',
  name: 'mcp__codex_apps__google_calendar___create_event',
  matcher: 'exact',
  provider: 'codex',
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

describe('findFirstToolRule Codex Apps name variants', () => {
  const rules: MergedToolRule[] = [{ ...codexAppsRule, source: 'bundle' }];

  it('matches bare dotted Codex Apps names on Codex', () => {
    const match = findFirstToolRule(
      'google_calendar.create_event',
      rules,
      'codex',
    );
    assert.equal(match?.matched.id, 'codex-gcal-create');
  });

  it('matches codex_apps-prefixed dotted names on Codex', () => {
    const match = findFirstToolRule(
      'codex_apps.google_calendar.create_event',
      rules,
      'codex',
    );
    assert.equal(match?.matched.id, 'codex-gcal-create');
  });

  it('matches mcp namespace plus dotted tool names on Codex', () => {
    const match = findFirstToolRule(
      'mcp__codex_apps__google_calendar._create_event',
      rules,
      'codex',
    );
    assert.equal(match?.matched.id, 'codex-gcal-create');
  });

  it('does not apply Codex Apps name expansion on other hosts', () => {
    const match = findFirstToolRule(
      'google_calendar.create_event',
      rules,
      'claude',
    );
    assert.equal(match, null);
  });

  it('still expands Codex Apps names when host identity is unknown', () => {
    const match = findFirstToolRule(
      'google_calendar.create_event',
      rules,
      undefined,
    );
    assert.equal(match?.matched.id, 'codex-gcal-create');
  });

  it('matches bare dotted Codex Apps names with one leading tool underscore', () => {
    const match = findFirstToolRule(
      'google_calendar._create_event',
      rules,
      'codex',
    );
    assert.equal(match?.matched.id, 'codex-gcal-create');
  });

  it('does not collapse multiple underscores in bare dotted Codex Apps names', () => {
    const match = findFirstToolRule(
      'google_calendar.__create_event',
      rules,
      'codex',
    );
    assert.equal(match, null);
  });

  it('does not collapse multiple underscores in mcp namespace tool names', () => {
    const match = findFirstToolRule(
      'mcp__codex_apps__google_calendar.__create_event',
      rules,
      'codex',
    );
    assert.equal(match, null);
  });
});

describe('Codex hook matcher', () => {
  it('catches dotted Codex Apps tool names', () => {
    const hooks = JSON.parse(
      readFileSync(
        new URL('../../../plugins/codex/hooks/hooks.json', import.meta.url),
        'utf8',
      ),
    ) as {
      hooks: {
        PreToolUse: { matcher: string }[];
        PermissionRequest: { matcher: string }[];
      };
    };
    const preToolUse = new RegExp(hooks.hooks.PreToolUse[0].matcher);
    const permissionRequest = new RegExp(
      hooks.hooks.PermissionRequest[0].matcher,
    );
    assert.equal(preToolUse.test('google_calendar.create_event'), true);
    assert.equal(
      preToolUse.test('mcp__codex_apps__google_calendar._create_event'),
      true,
    );
    assert.equal(permissionRequest.test('google_calendar.create_event'), true);
    assert.equal(
      permissionRequest.test('mcp__codex_apps__google_calendar._create_event'),
      true,
    );
    assert.equal(permissionRequest.test('Bash'), false);
  });
});
