/**
 * Unit tests for the guard tool-rule backend write flows
 * (`addToolRule`/`updateToolRule`/`removeToolRule`).
 *
 * These replace the retired local-file writes: each validates client-side, hits
 * the backend CRUD (`/v1/guard/rules`), then force-refreshes the bundle cache.
 * A throwaway HTTP server stands in for the backend; HOME is redirected so the
 * cache never touches the real `~/.transcodes`. The token + backend URL are
 * supplied via env (how `loadStepupConfig` resolves them).
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { loadSystemToolRules } from '@transcodes-guard-private/danger-rules';
import {
  addToolRule,
  removeToolRule,
  updateToolRule,
} from '../src/guard-rules.js';
import { policyBundleSha384, writeCachedPolicyBundle } from '../src/policy-bundle.js';

process.env.HOME = mkdtempSync(path.join(os.tmpdir(), 'guard-rules-flow-'));

const PROJECT = 'proj-flow';

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

const validInput = {
  id: 'gh-delete-repo',
  toolName: 'mcp__github__delete_repository',
  reason: 'Destructive repo deletion',
  stepupAction: 'delete',
  stepupResource: 'system',
};

type Captured = { method: string; pathname: string; body: unknown };

describe('guard tool-rule backend write flows', () => {
  let server: Server;
  let lastWrite: Captured | null = null;
  // Per-test program for the write endpoints.
  let writeRespond: () => { status: number; body?: unknown };

  before(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        // The post-write force-refresh fetches the bundle — answer with a valid
        // empty bundle so the flow's cache write succeeds.
        if (url.pathname === '/v1/guard/policy-bundle') {
          const body = { revision: '1', rules: [] };
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              payload: [{ ...body, manifest: { sha384: policyBundleSha384(body) } }],
              success: true,
              statusCode: 200,
            }),
          );
          return;
        }
        lastWrite = {
          method: req.method ?? '',
          pathname: url.pathname,
          body: raw ? JSON.parse(raw) : undefined,
        };
        const { status, body } = writeRespond();
        res.statusCode = status;
        if (body !== undefined) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        } else {
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    process.env.TRANSCODES_BACKEND_URL = `http://127.0.0.1:${address.port}`;
  });

  after(() => server.close());

  beforeEach(() => {
    lastWrite = null;
    process.env.TRANSCODES_TOKEN = fakeToken(PROJECT);
    writeRespond = () => ({ status: 200, body: { payload: [{ revision: '2' }] } });
  });

  it('POSTs a validated rule and defaults consume_in_hook to true', async () => {
    const rule = await addToolRule({ ...validInput });
    assert.equal(lastWrite?.method, 'POST');
    assert.equal(lastWrite?.pathname, '/v1/guard/rules');
    assert.equal(
      (lastWrite?.body as { rule_id?: string }).rule_id,
      'gh-delete-repo',
    );
    // Arbitrary MCP tool → the hook must consume (no transcodes handler).
    assert.equal((lastWrite?.body as { consume_in_hook?: boolean }).consume_in_hook, true);
    assert.equal(rule.consume_in_hook, true);
  });

  it('rejects a duplicate id (backend 409)', async () => {
    writeRespond = () => ({ status: 409, body: { error: 'exists' } });
    await assert.rejects(addToolRule({ ...validInput }), /already exists/);
  });

  it('rejects a malformed rule before any network call', async () => {
    let hit = false;
    writeRespond = () => {
      hit = true;
      return { status: 200 };
    };
    // A Bash command pasted as a tool name fails client-side validation.
    await assert.rejects(
      addToolRule({ ...validInput, toolName: 'rm -rf /' }),
      /looks like a Bash command/,
    );
    assert.equal(hit, false);
  });

  it('refuses to modify a system rule', async () => {
    const systemId = loadSystemToolRules().rules[0].id;
    await assert.rejects(
      removeToolRule(systemId),
      /system tool-rule and cannot be removed/,
    );
  });

  it('rejects an update for an id absent from the cached bundle', async () => {
    await assert.rejects(
      updateToolRule('not-in-cache', { reason: 'x' }),
      /no tool-rule with id/,
    );
  });

  it('merges changes onto the cached rule and PUTs the full replacement', async () => {
    const body = {
      revision: '5',
      rules: [
        {
          id: 'gh-delete-repo',
          toolName: 'mcp__github__delete_repository',
          reason: 'old reason',
          stepupAction: 'delete' as const,
          stepupResource: 'system',
        },
      ],
    };
    writeCachedPolicyBundle(PROJECT, {
      ...body,
      // schema parse happens in writeCachedPolicyBundle's caller; here the shape
      // already matches PolicyBundle.
    } as never);
    writeRespond = () => ({ status: 200, body: { payload: [{ revision: '6' }] } });

    const updated = await updateToolRule('gh-delete-repo', { reason: 'new reason' });
    assert.equal(lastWrite?.method, 'PUT');
    assert.equal(lastWrite?.pathname, '/v1/guard/rules/gh-delete-repo');
    // Unchanged fields are carried from the cached rule (PUT = full replace).
    assert.equal((lastWrite?.body as { tool_name?: string }).tool_name, 'mcp__github__delete_repository');
    assert.equal((lastWrite?.body as { reason?: string }).reason, 'new reason');
    assert.equal(updated.reason, 'new reason');
  });

  it('throws when no token is configured (no local fallback)', async () => {
    delete process.env.TRANSCODES_TOKEN;
    await assert.rejects(addToolRule({ ...validInput }), /No Transcodes token/);
  });
});
