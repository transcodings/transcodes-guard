/**
 * 403 → STEP_UP_REQUIRED translation tests (t10).
 *
 * The handler backstop is gone: `wrapProtectedTool` performs no RBAC check
 * and holds no verified state. Its whole contract is: run the handler, and
 * when the backend envelope reports 403, translate it into a structured
 * `STEP_UP_REQUIRED` result carrying the definition's stepUp coordinate.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { ProtectedToolDefinition } from '@transcodes-guard/core/contract';
import {
  clearTokenFile,
  writeTokenToFile,
} from '@transcodes-guard/core/stepup';
import { wrapProtectedTool } from '../src/mcp-tools/stepup-helper.js';

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
    'utf8'
  ).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function protectedDef(
  run: ProtectedToolDefinition['run'],
): ProtectedToolDefinition {
  return {
    name: 'tc_retire_role',
    title: 'Retire role',
    description: 'test',
    summary: 'test',
    category: 'RBAC',
    access: 'api',
    mutating: true,
    meta: false,
    stepUpProtected: true,
    stepUp: { action: 'delete', resource: 'system' },
    inputSchema: {},
    run,
  };
}

describe('wrapProtectedTool 403 translation', () => {
  afterEach(() => {
    clearTokenFile();
  });

  it('translates a 403 envelope into STEP_UP_REQUIRED with the stepUp coordinate', async () => {
    writeTokenToFile(fakeToken('member-1'), 'test');
    const handler = wrapProtectedTool(
      protectedDef(async () =>
        JSON.stringify({
          ok: false,
          status: 403,
          data: { message: 'Step-up MFA is not verified for this action.' },
        }),
      ),
    );

    const result = await handler({} as never);

    assert.equal(result.isError, true);
    const body = JSON.parse(result.content[0]?.text ?? '{}');
    assert.equal(body.code, 'STEP_UP_REQUIRED');
    assert.equal(body.tool, 'tc_retire_role');
    assert.equal(body.resource, 'system');
    assert.equal(body.action, 'delete');
    assert.equal(
      body.message,
      'Step-up MFA is not verified for this action.',
    );
    assert.ok(Array.isArray(body.next_actions));
    assert.match(body.next_actions.join(' '), /tc_create_stepup_session/);
    assert.match(body.next_actions.join(' '), /tc_poll_stepup_session_wait/);
  });

  it('passes any non-403 envelope through untouched', async () => {
    writeTokenToFile(fakeToken('member-1'), 'test');
    const text = JSON.stringify({ ok: true, status: 200, data: { id: 'x' } });
    const handler = wrapProtectedTool(protectedDef(async () => text));

    const result = await handler({} as never);

    assert.equal(result.isError, false);
    assert.equal(result.content[0]?.text, text);
  });

  it('passes non-JSON handler output through untouched', async () => {
    writeTokenToFile(fakeToken('member-1'), 'test');
    const handler = wrapProtectedTool(protectedDef(async () => 'plain text'));

    const result = await handler({} as never);

    assert.equal(result.isError, false);
    assert.equal(result.content[0]?.text, 'plain text');
  });

  it('loads the config before running the handler (member claims visible)', async () => {
    writeTokenToFile(fakeToken('member-42'), 'test');
    let seenMemberId: string | undefined;
    const handler = wrapProtectedTool(
      protectedDef(async (config) => {
        seenMemberId = config.memberId;
        return JSON.stringify({ ok: true, status: 200, data: null });
      }),
    );

    await handler({} as never);

    assert.equal(seenMemberId, 'member-42');
  });
});
