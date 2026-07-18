/**
 * Backend-403 → structured recovery translation tests (t10).
 *
 * `wrapProtectedTool` performs no RBAC check and holds no verified state.
 * Its whole contract is: run the handler (which returns the typed HTTP
 * envelope), and when the envelope reports 403, translate it into a
 * structured recovery result carrying the definition's stepUp coordinate,
 * branched on the guard's `errorCode` (STEP_UP_REQUIRED / RBAC_DENIED /
 * RBAC_UNRESOLVED; absent → step-up guidance).
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

/** Real backend 403 body: the exception filter puts the reason in `error`. */
function forbiddenBody(error: string, errorCode?: string) {
  return {
    logId: 'log-1',
    success: false,
    statusCode: 403,
    payload: null,
    error,
    ...(errorCode !== undefined && { errorCode }),
  };
}

describe('wrapProtectedTool 403 translation', () => {
  afterEach(() => {
    clearTokenFile();
  });

  it('translates errorCode STEP_UP_REQUIRED into step-up recovery guidance', async () => {
    writeTokenToFile(fakeToken('member-1'), 'test');
    const handler = wrapProtectedTool(
      protectedDef(async () => ({
        ok: false,
        status: 403,
        data: forbiddenBody(
          'Step-up MFA is not verified for this action.',
          'STEP_UP_REQUIRED',
        ),
      })),
    );

    const result = await handler({} as never);

    assert.equal(result.isError, true);
    const body = JSON.parse(result.content[0]?.text ?? '{}');
    assert.equal(body.code, 'STEP_UP_REQUIRED');
    assert.equal(body.tool, 'tc_retire_role');
    assert.equal(body.resource, 'system');
    assert.equal(body.action, 'delete');
    // Backend reason surfaces (filter `error` field), with logId appended.
    assert.equal(
      body.message,
      'Step-up MFA is not verified for this action.; logId=log-1',
    );
    assert.ok(Array.isArray(body.next_actions));
    const actions = body.next_actions.join(' ');
    assert.match(actions, /tc_create_stepup_session/);
    assert.match(actions, /summary/);
    assert.match(actions, /tc_poll_stepup_session_wait/);
  });

  it('defaults a 403 without errorCode (legacy backend) to step-up guidance', async () => {
    writeTokenToFile(fakeToken('member-1'), 'test');
    const handler = wrapProtectedTool(
      protectedDef(async () => ({
        ok: false,
        status: 403,
        data: forbiddenBody('Forbidden.'),
      })),
    );

    const result = await handler({} as never);

    const body = JSON.parse(result.content[0]?.text ?? '{}');
    assert.equal(body.code, 'STEP_UP_REQUIRED');
  });

  it('translates errorCode RBAC_DENIED into a no-auth-loop deny', async () => {
    writeTokenToFile(fakeToken('member-1'), 'test');
    const handler = wrapProtectedTool(
      protectedDef(async () => ({
        ok: false,
        status: 403,
        data: forbiddenBody('No permission for system/delete.', 'RBAC_DENIED'),
      })),
    );

    const result = await handler({} as never);

    assert.equal(result.isError, true);
    const body = JSON.parse(result.content[0]?.text ?? '{}');
    assert.equal(body.code, 'RBAC_DENIED');
    assert.equal(body.message, 'No permission for system/delete.; logId=log-1');
    const actions = body.next_actions.join(' ');
    // Must steer AWAY from the auth ceremony — step-up cannot elevate level 0.
    assert.match(actions, /Do not start a step-up session/);
    assert.doesNotMatch(actions, /tc_create_stepup_session/);
  });

  it('translates errorCode RBAC_UNRESOLVED into retry-later guidance', async () => {
    writeTokenToFile(fakeToken('member-1'), 'test');
    const handler = wrapProtectedTool(
      protectedDef(async () => ({
        ok: false,
        status: 403,
        data: forbiddenBody(
          'Unable to resolve RBAC permission for system/delete.',
          'RBAC_UNRESOLVED',
        ),
      })),
    );

    const result = await handler({} as never);

    const body = JSON.parse(result.content[0]?.text ?? '{}');
    assert.equal(body.code, 'RBAC_UNRESOLVED');
    const actions = body.next_actions.join(' ');
    assert.match(actions, /Retry tc_retire_role/);
    assert.doesNotMatch(actions, /tc_create_stepup_session/);
  });

  it('serializes any non-403 envelope through untouched', async () => {
    writeTokenToFile(fakeToken('member-1'), 'test');
    const envelope = { ok: true, status: 200, data: { id: 'x' } };
    const handler = wrapProtectedTool(protectedDef(async () => envelope));

    const result = await handler({} as never);

    assert.equal(result.isError, false);
    assert.equal(result.content[0]?.text, JSON.stringify(envelope, null, 2));
  });

  it('loads the config before running the handler (member claims visible)', async () => {
    writeTokenToFile(fakeToken('member-42'), 'test');
    let seenMemberId: string | undefined;
    const handler = wrapProtectedTool(
      protectedDef(async (config) => {
        seenMemberId = config.memberId;
        return { ok: true, status: 200, data: null };
      }),
    );

    await handler({} as never);

    assert.equal(seenMemberId, 'member-42');
  });
});
