/**
 * Unit tests for the G3 layered tool-rule merge:
 *   built-in baseline → cached project policy bundle.
 *
 * `loadMergedToolRules(bundleRules)` (danger-rules) carries the merge
 * semantics; `loadEffectiveToolRules()` (stepup-core) resolves the cached
 * bundle from the token's project claim. The per-user local layer was retired —
 * rules are centrally managed backend policy. HOME is pointed at a throwaway
 * tmp dir so the bundle cache never touches the real `~/.transcodes`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  loadMergedToolRules,
  loadSystemToolRules,
  type ToolRule,
} from '@transcodes-guard/danger-rules';
import {
  loadEffectiveToolRules,
  policyBundleSha384,
  verifyAndParsePolicyBundle,
  writeCachedPolicyBundle,
} from '../src/policy-bundle.js';

process.env.HOME = mkdtempSync(path.join(os.tmpdir(), 'guard-effective-rules-'));

const PROJECT = 'proj-effective';

function bundleRule(overrides: Partial<ToolRule> = {}): ToolRule {
  return {
    id: 'bundle-rule',
    toolName: 'mcp__org__dangerous_tool',
    reason: 'org policy',
    stepupAction: 'delete',
    stepupResource: 'system',
    ...overrides,
  };
}

/** Unsigned JWT-shaped token — signature verification is the backend's job
 * (jwt.ts policy), so tests only need a decodable payload. */
function fakeToken(projectId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      oid: 'org-test',
      pid: projectId,
      mid: 'member-test',
      aud: ['transcodes-mcp'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    'utf8',
  ).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe('loadMergedToolRules with a bundle layer', () => {
  it('appends bundle rules after the baseline with system-like defaults', () => {
    const merged = loadMergedToolRules([bundleRule()]);
    const fromBundle = merged.find((r) => r.id === 'bundle-rule');
    assert.ok(fromBundle);
    assert.equal(fromBundle.source, 'bundle');
    assert.equal(fromBundle.consume_in_hook, false);
    // Baseline is intact alongside the bundle layer.
    const systemCount = loadSystemToolRules().rules.length;
    assert.equal(merged.filter((r) => r.source === 'system').length, systemCount);
  });

  it('lets a bundle rule override a baseline rule with the same id, in place', () => {
    const systemRules = loadSystemToolRules().rules;
    const target = systemRules[0];
    const merged = loadMergedToolRules([
      bundleRule({ id: target.id, reason: 'org override' }),
    ]);
    const overridden = merged.find((r) => r.id === target.id);
    assert.ok(overridden);
    assert.equal(overridden.source, 'bundle');
    assert.equal(overridden.reason, 'org override');
    // Replacement keeps the original position (first-insertion order).
    assert.equal(merged[0].id, target.id);
    // No duplicate id survives the merge.
    assert.equal(merged.filter((r) => r.id === target.id).length, 1);
  });

  it('is baseline-only when no bundle is passed', () => {
    const merged = loadMergedToolRules();
    assert.equal(merged.find((r) => r.id === 'bundle-rule'), undefined);
    assert.ok(merged.every((r) => r.source === 'system'));
  });
});

describe('loadEffectiveToolRules', () => {
  it('merges the cached bundle for the token project', () => {
    const body = { revision: 'rev-eff', rules: [bundleRule()] };
    const bundle = verifyAndParsePolicyBundle({
      ...body,
      manifest: { sha384: policyBundleSha384(body) },
    });
    writeCachedPolicyBundle(PROJECT, bundle);
    const prev = process.env.TRANSCODES_TOKEN;
    process.env.TRANSCODES_TOKEN = fakeToken(PROJECT);
    try {
      const merged = loadEffectiveToolRules();
      assert.equal(merged.find((r) => r.id === 'bundle-rule')?.source, 'bundle');
    } finally {
      if (prev !== undefined) process.env.TRANSCODES_TOKEN = prev;
      else delete process.env.TRANSCODES_TOKEN;
    }
  });

  it('degrades to the baseline when no token is resolvable', () => {
    const prev = process.env.TRANSCODES_TOKEN;
    delete process.env.TRANSCODES_TOKEN;
    try {
      const merged = loadEffectiveToolRules();
      assert.equal(merged.find((r) => r.id === 'bundle-rule'), undefined);
      assert.ok(merged.some((r) => r.source === 'system'));
    } finally {
      if (prev !== undefined) process.env.TRANSCODES_TOKEN = prev;
    }
  });
});
