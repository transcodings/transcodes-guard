/**
 * Regression tests for the v0.32.0 raw-payload hotfix:
 *
 *  1. Host-internal meta tools (ToolSearch, ...) must bypass the gate —
 *     the backend classifier has no mapping for them, so gating them falls
 *     through to step-up and deadlocks the Stop-reminder loop.
 *  2. The challenge fingerprint must key off tool_name + tool_input, NOT the
 *     raw hook payload: the payload's session-constant prefix (session_id,
 *     transcript_path, cwd) exceeds the 200-char summary cap, so a
 *     payload-derived key collides across every non-shell tool call in a
 *     session — one verified step-up would unlock them all.
 *
 * Same temp-HOME + mock /v1/guard/evaluate + pre-claimed browser-lock
 * pattern as gate-f5-consume-in-hook.test.ts.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

let home: string;
const origHome = process.env.HOME;
const origBackendUrl = process.env.TRANSCODES_BACKEND_URL;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'guard-metatool-'));
  process.env.HOME = home;
  process.env.TRANSCODES_GUARD_HOST = 'claude';
  delete process.env.TRANSCODES_BACKEND_URL;
});

afterEach(() => {
  process.env.HOME = origHome;
  if (origBackendUrl === undefined) delete process.env.TRANSCODES_BACKEND_URL;
  else process.env.TRANSCODES_BACKEND_URL = origBackendUrl;
  rmSync(home, { recursive: true, force: true });
});

/** Minimal member token that satisfies parseMemberAccessToken. */
function fakeJwt(): string {
  const payload = Buffer.from(
    JSON.stringify({
      oid: 'org-meta',
      pid: 'proj-meta',
      mid: 'member-meta',
      aud: 'transcodes-mcp',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  return `h.${payload}.s`;
}

function writeTokenConfig(): void {
  const dir = path.join(home, '.transcodes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ token: fakeJwt() }));
}

/** Session-constant hook-payload fields long enough to exceed the 200-char
 * summary cap on their own — the collision vector this file guards against. */
function sessionEnvelope(): Record<string, unknown> {
  return {
    session_id: '310712fc-5d02-4a49-9abf-42ba0a460730',
    transcript_path:
      '/Users/gsong/.claude/projects/-Users-gsong-Projects/310712fc-5d02-4a49-9abf-42ba0a460730.jsonl',
    cwd: '/Users/gsong/Projects/some/deeply/nested/workspace/directory',
    hook_event_name: 'PreToolUse',
    permission_mode: 'default',
  };
}

describe('host-internal meta tools bypass the gate', () => {
  it('ToolSearch proceeds ungated without token or backend', async () => {
    const { evaluatePreToolUse } = await import('../src/evaluate.js');

    const decision = await evaluatePreToolUse({
      toolName: 'ToolSearch',
      toolInput: { query: 'select:Read' },
      rawPayload: {
        ...sessionEnvelope(),
        tool_name: 'ToolSearch',
        tool_input: { query: 'select:Read' },
      },
      cwd: '/tmp',
    });

    assert.equal(decision.kind, 'proceed-ungated');
  });
});

describe('challenge fingerprint keys off tool_name + tool_input', () => {
  it('two tools sharing a session-constant payload prefix get distinct fps', async () => {
    const { evaluatePreToolUse } = await import('../src/evaluate.js');
    const { fingerprintOf } = await import('../src/gate.js');
    const { cacheDir } = await import('@transcodes-guard/plugin-paths');

    writeTokenConfig();
    mkdirSync(cacheDir(), { recursive: true });

    const server: Server = createServer((req, res) => {
      assert.equal(req.url, '/v1/guard/evaluate');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          logId: 'x',
          success: true,
          statusCode: 200,
          payload: [
            {
              permission: 2,
              resource: 'command',
              action: 'update',
              reasoning: 'test verdict',
              consume_in_hook: true,
              sid: `sid-${Math.random().toString(36).slice(2)}`,
              url: 'http://127.0.0.1:9/never-opened',
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
          error: null,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    process.env.TRANSCODES_BACKEND_URL = `http://127.0.0.1:${address.port}`;

    const calls = [
      { toolName: 'mcp__foo__alpha', toolInput: { target: 'a' } },
      { toolName: 'mcp__foo__beta', toolInput: { target: 'b' } },
    ];

    try {
      const fps: string[] = [];
      for (const call of calls) {
        const expectedFp = fingerprintOf(
          `${call.toolName}:${JSON.stringify(call.toolInput)}`,
        );
        // Pre-claim the browser lock for the expected fp so the gate never
        // spawns a real browser from the test run.
        writeFileSync(
          path.join(cacheDir(), 'stepup-browser-lock.json'),
          JSON.stringify({ fingerprint: expectedFp, openedAt: Date.now() }),
        );

        const decision = await evaluatePreToolUse({
          toolName: call.toolName,
          toolInput: call.toolInput,
          rawPayload: {
            ...sessionEnvelope(),
            tool_name: call.toolName,
            tool_input: call.toolInput,
          },
          cwd: '/tmp',
        });

        assert.equal(decision.kind, 'block-stepup-challenged');
        assert.ok('pending' in decision);
        assert.equal(decision.pending.fp, expectedFp);
        // The stored command must lead with the tool call, not the raw
        // payload's session envelope.
        assert.ok(decision.pending.command.startsWith(`${call.toolName} `));
        assert.ok(!decision.pending.command.includes('transcript_path'));
        assert.ok(decision.pending.fp);
        fps.push(decision.pending.fp);
      }
      assert.notEqual(fps[0], fps[1]);
    } finally {
      server.close();
    }
  });
});
