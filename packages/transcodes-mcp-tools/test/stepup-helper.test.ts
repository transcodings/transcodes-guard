import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import {
  loadMergedToolRules,
  type MergedToolRule,
} from '@transcodes-guard/danger-patterns';
import {
  clearPending,
  consumeVerified,
  readVerified,
  writeVerified,
} from '@transcodes-guard/stepup-core';
import {
  execProtectedTool,
  resolveProtectedToolRule,
} from '../src/stepup-helper.js';

process.env.HOME = mkdtempSync(path.join(os.tmpdir(), 'guard-mcp-tools-'));

function fakeToken(memberId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      oid: 'org-test',
      pid: 'proj-test',
      mid: memberId,
      aud: ['transcodes-mcp'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    'utf8',
  ).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function systemRule(overrides: Partial<MergedToolRule> = {}): MergedToolRule {
  return {
    id: 'tc-custom',
    type: 'mcp',
    label: 'Custom rule',
    description: 'Custom rule',
    name: 'mcp__plugin_transcodes-guard_transcodes-guard__custom_tool',
    matcher: 'exact',
    action: 'create',
    resource: 'system',
    source: 'system',
    ...overrides,
  };
}

describe('step-up protected tool rule resolution', () => {
  it('matches the local handler name to the system MCP wire rule', () => {
    const rule = resolveProtectedToolRule('create_resource');

    assert.equal(rule?.id, 'tc-create-resource');
    assert.equal(rule?.resource, 'system');
    assert.equal(rule?.action, 'create');
  });

  it('still matches the full MCP wire name directly', () => {
    const rules = loadMergedToolRules();
    const rule = resolveProtectedToolRule(
      'mcp__plugin_transcodes-guard_transcodes-guard__create_resource',
      rules,
    );

    assert.equal(rule?.id, 'tc-create-resource');
  });

  it('does not match unrelated handler names', () => {
    const rule = resolveProtectedToolRule('unknown_tool');

    assert.equal(rule, undefined);
  });

  it('does not resolve local handler names from bundle rules', () => {
    const bundleRule: MergedToolRule = {
      id: 'external-create-resource',
      type: 'mcp',
      label: 'External create resource',
      description: 'External tool with the same suffix',
      name: 'mcp__external__server__create_resource',
      matcher: 'exact',
      action: 'create',
      resource: 'system',
      source: 'bundle',
    };
    const localExactRule: MergedToolRule = {
      ...bundleRule,
      id: 'bundle-local-exact',
      name: 'create_resource',
    };
    const localGlobRule: MergedToolRule = {
      ...bundleRule,
      id: 'bundle-local-glob',
      name: 'create_*',
      matcher: 'glob',
    };

    const rule = resolveProtectedToolRule('create_resource', [
      bundleRule,
      localExactRule,
      localGlobRule,
    ]);

    assert.equal(rule, undefined);
  });

  it('does not misread canonical tool ids that contain double underscores', () => {
    const rules = [
      systemRule({
        name: 'mcp__plugin_transcodes-guard_transcodes-guard__project__archive',
      }),
    ];

    assert.equal(resolveProtectedToolRule('archive', rules), undefined);
    assert.equal(
      resolveProtectedToolRule('project__archive', rules)?.id,
      'tc-custom',
    );
  });

  it('does not resolve provider-scoped local handler rules on another host', () => {
    const previous = process.env.TRANSCODES_GUARD_HOST;
    process.env.TRANSCODES_GUARD_HOST = 'codex';
    try {
      const rules = [
        systemRule({
          provider: 'cursor',
          name: 'mcp__plugin_transcodes-guard_transcodes-guard__custom_tool',
        }),
      ];

      assert.equal(resolveProtectedToolRule('custom_tool', rules), undefined);
    } finally {
      if (previous !== undefined) process.env.TRANSCODES_GUARD_HOST = previous;
      else delete process.env.TRANSCODES_GUARD_HOST;
    }
  });
});

describe('execProtectedTool step-up backstop', () => {
  let server: Server;
  let baseUrl: string;
  let requestedPaths: string[] = [];
  let permission: 0 | 1 | 2 = 2;

  before(async () => {
    server = createServer((req, res) => {
      requestedPaths.push(`${req.method} ${req.url}`);
      if (req.url === '/v1/auth/role/check-permission') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            logId: 'test',
            success: true,
            statusCode: 200,
            payload: [{ permission, resource: 'system', action: 'create' }],
            error: null,
          }),
        );
        return;
      }
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'unexpected request' }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(() => server.close());

  afterEach(() => {
    requestedPaths = [];
    permission = 2;
    consumeVerified();
    clearPending();
    delete process.env.TRANSCODES_TOKEN;
    delete process.env.TRANSCODES_BACKEND_URL;
  });

  it('denies level-2 without creating a step-up session from the handler', async () => {
    process.env.TRANSCODES_TOKEN = fakeToken('member-level-2');
    process.env.TRANSCODES_BACKEND_URL = baseUrl;
    let called = false;

    const result = await execProtectedTool('create_resource', async () => {
      called = true;
      return 'should not run';
    });

    assert.equal(result.isError, true);
    assert.equal(called, false);
    assert.match(result.content[0]?.text ?? '', /"code": "STEP_UP_REQUIRED"/);
    assert.deepEqual(requestedPaths, ['POST /v1/auth/role/check-permission']);
  });

  it('consumes a stale verified record after a level-1 allow path', async () => {
    process.env.TRANSCODES_TOKEN = fakeToken('member-level-1');
    process.env.TRANSCODES_BACKEND_URL = baseUrl;
    permission = 1;
    writeVerified({ sid: 'stale-sid', verifiedAt: Date.now() });

    const result = await execProtectedTool('create_resource', async (sid) => {
      assert.equal(sid, undefined);
      return 'ok';
    });

    assert.equal(result.isError, false);
    assert.equal(result.content[0]?.text, 'ok');
    assert.equal(readVerified(), null);
  });
});
