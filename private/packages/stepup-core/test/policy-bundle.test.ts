/**
 * Unit tests for the policy-bundle client core (Phase 3 v2 Unit G, G1).
 *
 * Runs with the Node builtin test runner via tsx (`npm test` in this
 * package). HOME is pointed at a throwaway tmp dir so `cacheDir()` (which
 * resolves from os.homedir() at call time, inside each test body) never
 * touches the real `~/.transcodes/state`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { StepupConfig } from '../src/config.js';
import {
  policyBundleCachePath,
  policyBundleSha384,
  readCachedPolicyBundle,
  refreshPolicyBundle,
  refreshPolicyBundleIfConfigured,
  verifyAndParsePolicyBundle,
  writeCachedPolicyBundle,
} from '../src/policy-bundle.js';

process.env.HOME = mkdtempSync(path.join(os.tmpdir(), 'guard-policy-bundle-'));

const ORG = 'org-test';

function makeBundleBody(revision = 'rev-001') {
  return {
    revision,
    rules: [
      {
        id: 'retire-member',
        toolName: 'mcp__transcodes__retire_member',
        reason: 'destructive member operation',
        stepupAction: 'delete',
        stepupResource: 'member',
      },
    ],
  };
}

function makeBundleResponse(revision = 'rev-001') {
  const body = makeBundleBody(revision);
  return { ...body, manifest: { sha384: policyBundleSha384(body) } };
}

function configFor(baseUrl: string): StepupConfig {
  return {
    backendUrl: baseUrl,
    apiBaseV1: `${baseUrl}/v1`,
    token: 'test-token',
    organizationId: ORG,
    projectId: 'proj-test',
    memberId: 'member-test',
  };
}

function clearCache() {
  rmSync(policyBundleCachePath(ORG), { force: true });
}

describe('policyBundleSha384 (canonicalization contract)', () => {
  it('matches the pinned hash for the reference body', () => {
    // Pinned regression value — if canonicalization ever changes, this fails
    // and the backend contract must be renegotiated, not silently drifted.
    assert.equal(
      policyBundleSha384(makeBundleBody()),
      '589999f3da7c581e50ef646ecf4d641036fd9e6574569cfc13fa950960417d672c5a5aa80a405594de50aab7b3ddd029',
    );
  });

  it('is insensitive to object key order', () => {
    const reordered = {
      rules: [
        {
          stepupResource: 'member',
          stepupAction: 'delete',
          reason: 'destructive member operation',
          toolName: 'mcp__transcodes__retire_member',
          id: 'retire-member',
        },
      ],
      revision: 'rev-001',
    };
    assert.equal(
      policyBundleSha384(reordered),
      policyBundleSha384(makeBundleBody()),
    );
  });
});

describe('verifyAndParsePolicyBundle', () => {
  it('accepts a valid bundle', () => {
    const bundle = verifyAndParsePolicyBundle(makeBundleResponse());
    assert.equal(bundle.revision, 'rev-001');
    assert.equal(bundle.rules.length, 1);
    assert.equal(bundle.rules[0].stepupAction, 'delete');
  });

  it('hashes unknown body fields but strips them from the parse', () => {
    const body = { ...makeBundleBody(), futureField: { nested: true } };
    const raw = { ...body, manifest: { sha384: policyBundleSha384(body) } };
    const bundle = verifyAndParsePolicyBundle(raw);
    assert.ok(!('futureField' in bundle));
  });

  it('rejects a tampered body (hash mismatch)', () => {
    const raw = makeBundleResponse();
    raw.rules[0].stepupAction = 'read';
    assert.throws(() => verifyAndParsePolicyBundle(raw), /sha384 mismatch/);
  });

  it('rejects a missing or malformed manifest', () => {
    const { manifest: _drop, ...noManifest } = makeBundleResponse();
    assert.throws(
      () => verifyAndParsePolicyBundle(noManifest),
      /manifest\.sha384/,
    );
    assert.throws(
      () =>
        verifyAndParsePolicyBundle({
          ...noManifest,
          manifest: { sha384: 'nope' },
        }),
      /manifest\.sha384/,
    );
  });

  it('rejects a schema-invalid bundle even with a correct hash', () => {
    const body = {
      revision: 'rev-001',
      rules: [{ id: 'broken-rule', toolName: 'x' }],
    };
    const raw = { ...body, manifest: { sha384: policyBundleSha384(body) } };
    assert.throws(() => verifyAndParsePolicyBundle(raw), /schema invalid/);
  });

  it('rejects non-object bodies', () => {
    assert.throws(() => verifyAndParsePolicyBundle(null), /not an object/);
    assert.throws(() => verifyAndParsePolicyBundle([1]), /not an object/);
  });
});

describe('cache read/write', () => {
  beforeEach(clearCache);

  it('round-trips a bundle and reports it fresh within TTL', () => {
    const bundle = verifyAndParsePolicyBundle(makeBundleResponse());
    writeCachedPolicyBundle(ORG, bundle);
    const cached = readCachedPolicyBundle(ORG);
    assert.ok(cached);
    assert.equal(cached.bundle.revision, 'rev-001');
    assert.equal(cached.fresh, true);
  });

  it('returns a stale bundle with fresh=false (last-known-good)', () => {
    const bundle = verifyAndParsePolicyBundle(makeBundleResponse());
    writeCachedPolicyBundle(ORG, bundle);
    const cached = readCachedPolicyBundle(ORG, 0);
    assert.ok(cached);
    assert.equal(cached.fresh, false);
  });

  it('reads corrupt or schema-invalid cache files as absent', () => {
    assert.equal(readCachedPolicyBundle(ORG), null);
    writeFileSync(policyBundleCachePath(ORG), 'not json');
    assert.equal(readCachedPolicyBundle(ORG), null);
    writeFileSync(
      policyBundleCachePath(ORG),
      JSON.stringify({ fetchedAt: Date.now(), bundle: { revision: '' } }),
    );
    assert.equal(readCachedPolicyBundle(ORG), null);
  });

  it('sanitizes the org id in the cache filename', () => {
    const p = policyBundleCachePath('../evil/org');
    assert.equal(path.dirname(p), path.dirname(policyBundleCachePath(ORG)));
    assert.ok(path.basename(p).startsWith('policy-bundle...'));
  });
});

describe('refreshPolicyBundle', () => {
  let server: Server;
  let baseUrl: string;
  let requestCount = 0;
  // Per-test response program: status + JSON body.
  let respond: (revision: string | null) => { status: number; body?: unknown };

  before(async () => {
    server = createServer((req, res) => {
      requestCount += 1;
      const url = new URL(req.url ?? '/', 'http://localhost');
      assert.equal(url.pathname, '/v1/guard/policy-bundle');
      assert.equal(req.headers['x-transcodes-token'], 'test-token');
      const { status, body } = respond(url.searchParams.get('revision'));
      res.statusCode = status;
      if (body !== undefined) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      } else {
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(() => server.close());

  beforeEach(() => {
    clearCache();
    requestCount = 0;
  });

  it('fetches, verifies, and caches a new bundle', async () => {
    respond = () => ({ status: 200, body: makeBundleResponse() });
    const outcome = await refreshPolicyBundle(configFor(baseUrl));
    assert.equal(outcome, 'refreshed');
    assert.equal(readCachedPolicyBundle(ORG)?.bundle.revision, 'rev-001');
  });

  it('skips the network entirely while the cache is fresh', async () => {
    respond = () => ({ status: 200, body: makeBundleResponse() });
    await refreshPolicyBundle(configFor(baseUrl));
    assert.equal(requestCount, 1);
    const outcome = await refreshPolicyBundle(configFor(baseUrl));
    assert.equal(outcome, 'fresh');
    assert.equal(requestCount, 1);
  });

  it('sends the cached revision and restarts TTL on 304', async () => {
    respond = () => ({ status: 200, body: makeBundleResponse() });
    await refreshPolicyBundle(configFor(baseUrl));
    const first = readCachedPolicyBundle(ORG);
    assert.ok(first);
    await new Promise((r) => setTimeout(r, 5));
    respond = (revision) => {
      assert.equal(revision, 'rev-001');
      return { status: 304 };
    };
    const outcome = await refreshPolicyBundle(configFor(baseUrl), {
      force: true,
    });
    assert.equal(outcome, 'not-modified');
    const cached = readCachedPolicyBundle(ORG);
    assert.ok(cached && cached.fetchedAt > first.fetchedAt);
    assert.equal(cached.bundle.revision, 'rev-001');
  });

  it('keeps the previous cache when the backend errors', async () => {
    respond = () => ({ status: 200, body: makeBundleResponse() });
    await refreshPolicyBundle(configFor(baseUrl));
    respond = () => ({ status: 500, body: { error: 'boom' } });
    const outcome = await refreshPolicyBundle(configFor(baseUrl), {
      force: true,
    });
    assert.equal(outcome, 'failed');
    assert.equal(readCachedPolicyBundle(ORG)?.bundle.revision, 'rev-001');
  });

  it('refuses to activate a tampered bundle and keeps the previous cache', async () => {
    respond = () => ({ status: 200, body: makeBundleResponse() });
    await refreshPolicyBundle(configFor(baseUrl));
    respond = () => {
      const tampered = makeBundleResponse('rev-002');
      tampered.rules[0].stepupAction = 'read';
      return { status: 200, body: tampered };
    };
    const outcome = await refreshPolicyBundle(configFor(baseUrl), {
      force: true,
    });
    assert.equal(outcome, 'failed');
    assert.equal(readCachedPolicyBundle(ORG)?.bundle.revision, 'rev-001');
  });

  it('reports failed (not a throw) when the backend is unreachable', async () => {
    const outcome = await refreshPolicyBundle(configFor('http://127.0.0.1:1'));
    assert.equal(outcome, 'failed');
    assert.equal(readCachedPolicyBundle(ORG), null);
  });

  it('unwraps the backend response envelope (payload[0]) before verifying', async () => {
    respond = () => ({
      status: 200,
      body: {
        logId: 'log-1',
        success: true,
        statusCode: 200,
        payload: [makeBundleResponse('rev-env')],
        error: null,
      },
    });
    const outcome = await refreshPolicyBundle(configFor(baseUrl));
    assert.equal(outcome, 'refreshed');
    assert.equal(readCachedPolicyBundle(ORG)?.bundle.revision, 'rev-env');
  });

  it('still accepts a bare (non-enveloped) bundle body', async () => {
    respond = () => ({ status: 200, body: makeBundleResponse('rev-bare') });
    const outcome = await refreshPolicyBundle(configFor(baseUrl));
    assert.equal(outcome, 'refreshed');
    assert.equal(readCachedPolicyBundle(ORG)?.bundle.revision, 'rev-bare');
  });
});

describe('refreshPolicyBundleIfConfigured', () => {
  it('skips silently when no token is resolvable', async () => {
    const prev = process.env.TRANSCODES_TOKEN;
    delete process.env.TRANSCODES_TOKEN;
    try {
      // HOME points at the test tmp dir, so no token file exists either.
      assert.equal(await refreshPolicyBundleIfConfigured(), 'skipped');
    } finally {
      if (prev !== undefined) process.env.TRANSCODES_TOKEN = prev;
    }
  });
});
