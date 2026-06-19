/**
 * Unit tests for bundle-backed Bash pattern merge (loadEffectivePatterns).
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  loadMergedPatterns,
  type ToolRule,
} from '@transcodes-guard/danger-patterns';
import {
  GUARD_POLICY_BUNDLE_SCHEMA_VERSION,
  loadEffectivePatterns,
  policyBundleSha384,
  verifyAndParsePolicyBundle,
  writeCachedPolicyBundle,
} from '../src/policy-bundle.js';

process.env.HOME = mkdtempSync(
  path.join(os.tmpdir(), 'guard-effective-patterns-'),
);

const PROJECT = 'proj-effective-patterns';

function bashBundleRule(overrides: Partial<ToolRule> = {}): ToolRule {
  return {
    id: 'bundle-bash',
    type: 'bash',
    label: 'Org bash policy',
    description: 'destructive rm -rf',
    name: 'rm\\s+-rf',
    matcher: 'regex',
    action: 'delete',
    resource: 'system',
    ...overrides,
  };
}

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

describe('loadEffectivePatterns', () => {
  it('appends cached bundle bash rules after system patterns', () => {
    const body = {
      schemaVersion: GUARD_POLICY_BUNDLE_SCHEMA_VERSION,
      revision: 'rev-bash',
      rules: [bashBundleRule()],
    };
    const bundle = verifyAndParsePolicyBundle({
      ...body,
      manifest: { sha384: policyBundleSha384(body) },
    });
    writeCachedPolicyBundle(PROJECT, bundle);
    const prev = process.env.TRANSCODES_TOKEN;
    process.env.TRANSCODES_TOKEN = fakeToken(PROJECT);
    try {
      const merged = loadEffectivePatterns();
      const systemCount = loadMergedPatterns().length;
      assert.equal(merged.length, systemCount + 1);
      const fromBundle = merged.find((p) => p.id === 'bundle-bash');
      assert.ok(fromBundle);
      assert.equal(fromBundle.source, 'bundle');
      assert.equal(fromBundle.regex, 'rm\\s+-rf');
      assert.equal(fromBundle.reason, 'destructive rm -rf');
      assert.equal(fromBundle.stepupAction, 'delete');
      assert.equal(fromBundle.stepupResource, 'system');
    } finally {
      if (prev !== undefined) process.env.TRANSCODES_TOKEN = prev;
      else delete process.env.TRANSCODES_TOKEN;
    }
  });

  it('ignores mcp rules in the bundle (bash-only merge)', () => {
    const body = {
      schemaVersion: GUARD_POLICY_BUNDLE_SCHEMA_VERSION,
      revision: 'rev-mixed',
      rules: [
        bashBundleRule(),
        {
          id: 'mcp-only',
          type: 'mcp' as const,
          label: 'MCP rule',
          description: 'not a bash pattern',
          name: 'mcp__org__tool',
          matcher: 'exact' as const,
          action: 'delete' as const,
          resource: 'member',
        },
      ],
    };
    const bundle = verifyAndParsePolicyBundle({
      ...body,
      manifest: { sha384: policyBundleSha384(body) },
    });
    writeCachedPolicyBundle(PROJECT, bundle);
    const prev = process.env.TRANSCODES_TOKEN;
    process.env.TRANSCODES_TOKEN = fakeToken(PROJECT);
    try {
      const merged = loadEffectivePatterns();
      assert.equal(merged.find((p) => p.id === 'bundle-bash')?.source, 'bundle');
      assert.equal(merged.find((p) => p.id === 'mcp-only'), undefined);
    } finally {
      if (prev !== undefined) process.env.TRANSCODES_TOKEN = prev;
      else delete process.env.TRANSCODES_TOKEN;
    }
  });

  it('degrades to system-only when no token is resolvable', () => {
    const prev = process.env.TRANSCODES_TOKEN;
    delete process.env.TRANSCODES_TOKEN;
    try {
      const merged = loadEffectivePatterns();
      assert.equal(merged.find((p) => p.id === 'bundle-bash'), undefined);
      assert.ok(merged.every((p) => p.source === 'system'));
    } finally {
      if (prev !== undefined) process.env.TRANSCODES_TOKEN = prev;
    }
  });
});
