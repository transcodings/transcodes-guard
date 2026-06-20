/**
 * Provider-scoped matching: a rule with `provider` fires only on its own host,
 * a rule without `provider` (system baseline) fires on every host. Fail-safe
 * when the host is unknown (match everything rather than silently skip).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  currentHostProvider,
  findFirstToolRule,
  loadMergedToolRules,
  type MergedToolRule,
  mapHostToProvider,
  ruleAppliesToHost,
  type ToolRule,
} from '../src/tool-rules.js';

const codexRule: ToolRule = {
  id: 'codex-mongodb-list-collections',
  type: 'mcp',
  label: 'MongoDB list collections (codex)',
  description: 'step-up before listing collections on codex',
  name: 'mcp__mongodb__list_collections',
  matcher: 'exact',
  provider: 'codex',
};

const antigravityRule: ToolRule = {
  ...codexRule,
  id: 'antigravity-mongodb-list-collections',
  label: 'MongoDB list collections (antigravity)',
  provider: 'antigravity',
};

const systemRule: ToolRule = {
  id: 'tc-retire-member',
  type: 'mcp',
  label: 'Retire member',
  description: 'baseline — every host',
  name: 'mcp__plugin_transcodes-guard_transcodes-guard__retire_member',
  matcher: 'exact',
};

describe('mapHostToProvider', () => {
  it('maps claude-code → claude', () => {
    assert.equal(mapHostToProvider('claude-code'), 'claude');
  });

  it('passes through codex/cursor/antigravity unchanged', () => {
    assert.equal(mapHostToProvider('codex'), 'codex');
    assert.equal(mapHostToProvider('cursor'), 'cursor');
    assert.equal(mapHostToProvider('antigravity'), 'antigravity');
  });

  it('returns undefined for unknown or empty host', () => {
    assert.equal(mapHostToProvider('weird-host'), undefined);
    assert.equal(mapHostToProvider(undefined), undefined);
    assert.equal(mapHostToProvider(''), undefined);
  });
});

describe('currentHostProvider', () => {
  it('reflects TRANSCODES_GUARD_HOST', () => {
    const prev = process.env.TRANSCODES_GUARD_HOST;
    try {
      process.env.TRANSCODES_GUARD_HOST = 'claude';
      assert.equal(currentHostProvider(), 'claude');
      process.env.TRANSCODES_GUARD_HOST = 'codex';
      assert.equal(currentHostProvider(), 'codex');
      delete process.env.TRANSCODES_GUARD_HOST;
      assert.equal(currentHostProvider(), undefined);
    } finally {
      if (prev === undefined) delete process.env.TRANSCODES_GUARD_HOST;
      else process.env.TRANSCODES_GUARD_HOST = prev;
    }
  });
});

describe('ruleAppliesToHost', () => {
  it('provider-less rule applies to every host (and unknown host)', () => {
    assert.equal(ruleAppliesToHost(systemRule, 'codex'), true);
    assert.equal(ruleAppliesToHost(systemRule, 'antigravity'), true);
    assert.equal(ruleAppliesToHost(systemRule, undefined), true);
  });

  it('provider-scoped rule applies only on its own host', () => {
    assert.equal(ruleAppliesToHost(codexRule, 'codex'), true);
    assert.equal(ruleAppliesToHost(codexRule, 'antigravity'), false);
    assert.equal(ruleAppliesToHost(codexRule, 'cursor'), false);
  });

  it('fails safe (matches) when the host is unknown', () => {
    assert.equal(ruleAppliesToHost(codexRule, undefined), true);
  });
});

describe('findFirstToolRule provider scoping', () => {
  const rules: MergedToolRule[] = [
    { ...codexRule, source: 'bundle' },
    { ...antigravityRule, source: 'bundle' },
  ];

  it('on codex, matches only the codex-scoped rule', () => {
    const match = findFirstToolRule(
      'mcp__mongodb__list_collections',
      rules,
      'codex',
    );
    assert.equal(match?.matched.id, 'codex-mongodb-list-collections');
  });

  it('on antigravity, matches only the antigravity-scoped rule', () => {
    const match = findFirstToolRule(
      'mcp__mongodb__list_collections',
      rules,
      'antigravity',
    );
    assert.equal(match?.matched.id, 'antigravity-mongodb-list-collections');
  });

  it('on cursor (no matching scoped rule), does not match', () => {
    const match = findFirstToolRule(
      'mcp__mongodb__list_collections',
      rules,
      'cursor',
    );
    assert.equal(match, null);
  });

  it('a provider-less rule still matches on the scoped host', () => {
    const mixed: MergedToolRule[] = [{ ...systemRule, source: 'system' }];
    const match = findFirstToolRule(
      'mcp__plugin_transcodes-guard_transcodes-guard__retire_member',
      mixed,
      'cursor',
    );
    assert.equal(match?.matched.id, 'tc-retire-member');
  });
});

describe('loadMergedToolRules provider normalization', () => {
  it('folds a legacy `claude-code` provider down to `claude`', () => {
    const legacy = {
      id: 'legacy-claude-code-rule',
      type: 'mcp',
      name: 'mcp__mongodb__list_collections',
      matcher: 'exact',
      // Raw, non-canonical host id as could exist in an old record.
      provider: 'claude-code',
    } as unknown as ToolRule;

    const merged = loadMergedToolRules([legacy]);
    const stored = merged.find((r) => r.id === 'legacy-claude-code-rule');
    assert.equal(stored?.provider, 'claude');

    // On the claude host the hook computes currentHostProvider() === 'claude'
    // (mapHostToProvider folds 'claude-code' → 'claude'). The normalized rule
    // then matches; left as raw 'claude-code' it would NOT.
    const match = findFirstToolRule(
      'mcp__mongodb__list_collections',
      merged,
      mapHostToProvider('claude-code'),
    );
    assert.equal(match?.matched.id, 'legacy-claude-code-rule');
  });
});
