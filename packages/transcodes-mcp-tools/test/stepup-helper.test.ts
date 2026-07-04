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
  claimStepupVerified,
  clearTokenFile,
  hasStepupVerified,
  markStepupVerified,
  writeTokenToFile,
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
    name: 'tc_custom_tool',
    matcher: 'exact',
    action: 'create',
    resource: 'system',
    source: 'system',
    ...overrides,
  };
}

describe('step-up protected tool rule resolution', () => {
  it('matches the registered MCP tool name to the system rule', () => {
    const rule = resolveProtectedToolRule('tc_create_resource');

    assert.equal(rule?.id, 'tc-create-resource');
    assert.equal(rule?.resource, 'system');
    assert.equal(rule?.action, 'create');
  });

  it('still matches host-wrapped MCP wire names', () => {
    const rules = loadMergedToolRules();
    const rule = resolveProtectedToolRule(
      'tc_create_resource',
      rules,
    );

    assert.equal(rule?.id, 'tc-create-resource');
  });

  it('does not match unrelated handler names', () => {
    const rule = resolveProtectedToolRule('unknown_tool');

    assert.equal(rule, undefined);
  });

  it('does not resolve transcodes tool names from bundle rules', () => {
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

    const rule = resolveProtectedToolRule('tc_create_resource', [
      bundleRule,
    ]);

    assert.equal(rule, undefined);
  });

  it('does not misread canonical tool ids that contain double underscores', () => {
    const rules = [
      systemRule({
        name: 'tc_project__archive',
      }),
    ];

    assert.equal(resolveProtectedToolRule('archive', rules), undefined);
    assert.equal(
      resolveProtectedToolRule('tc_project__archive', rules)?.id,
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
          name: 'tc_custom_tool',
        }),
      ];

      assert.equal(resolveProtectedToolRule('tc_custom_tool', rules), undefined);
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
    // Drain any leftover in-memory verified sid between cases.
    claimStepupVerified();
    clearTokenFile();
    delete process.env.TRANSCODES_BACKEND_URL;
  });

  it('denies level-2 without creating a step-up session from the handler', async () => {
    writeTokenToFile(fakeToken('member-level-2'), 'test');
    process.env.TRANSCODES_BACKEND_URL = baseUrl;
    let called = false;

    const result = await execProtectedTool('tc_create_resource', async () => {
      called = true;
      return 'should not run';
    });

    assert.equal(result.isError, true);
    assert.equal(called, false);
    assert.match(result.content[0]?.text ?? '', /"code": "STEP_UP_REQUIRED"/);
    assert.deepEqual(requestedPaths, ['POST /v1/auth/role/check-permission']);
  });

  it('runs level-1 with no sid and leaves the verified set untouched', async () => {
    writeTokenToFile(fakeToken('member-level-1'), 'test');
    process.env.TRANSCODES_BACKEND_URL = baseUrl;
    permission = 1;
    markStepupVerified('unrelated-sid');

    const result = await execProtectedTool('tc_create_resource', async (sid) => {
      assert.equal(sid, undefined);
      return 'ok';
    });

    assert.equal(result.isError, false);
    assert.equal(result.content[0]?.text, 'ok');
    // Level 1 never touches the in-memory verified set.
    assert.equal(hasStepupVerified(), true);
  });

  it('consumes a verified sid single-shot on the level-2 path', async () => {
    writeTokenToFile(fakeToken('member-level-2'), 'test');
    process.env.TRANSCODES_BACKEND_URL = baseUrl;
    permission = 2;
    markStepupVerified('fresh-sid');

    const result = await execProtectedTool('tc_create_resource', async (sid) => {
      assert.equal(sid, 'fresh-sid');
      return 'ok';
    });

    assert.equal(result.isError, false);
    assert.equal(result.content[0]?.text, 'ok');
    // Single-shot: the sid is gone after one successful level-2 run.
    assert.equal(hasStepupVerified(), false);
  });
});
