/**
 * toolgate t3 §3 — the hook's whole decision surface, pinned.
 *
 * Guard v3 gives the client exactly one job on a gated call: ask
 * `POST /guard/evaluate` and do what the answer says. This file pins that
 * mapping (permission × verified → decision) plus the two properties the t3
 * teardown is FOR:
 *
 *  - fail-closed: an unusable answer (unreachable / malformed / non-2xx) must
 *    land on the step-up side, never on allow.
 *  - no local state: a full gate run writes nothing to `~/.transcodes/state/`.
 *    The client cannot hold verified state if it never persists any.
 *
 * On the quadrant count: t3 §0-2 describes four (0 / 1 / 2+verified /
 * 2+unverified), but the client only ever sees three. A verified coordinate
 * never arrives as "permission 2 + verified" — `sessionRedirectResult`
 * (backend `temp-session.service.ts`) rewrites a reused VERIFIED session to
 * `decision:'allow'` + `permission: 1` before it goes on the wire, so the
 * already-verified case lands on the plain permission-1 pass below. Pinned here
 * because the asymmetry is invisible from this side: do NOT add a
 * `status === 'verified'` branch to evaluate.ts to "complete" the matrix — it
 * would be dead code guarding a shape the backend does not emit.
 */
import assert from 'node:assert/strict';
import { readdirSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  makeHomeSandbox,
  startJsonBackend,
  startUnreachableBackend,
} from './helpers/evaluate-harness.js';

type VerdictOverrides = {
  permission: 0 | 1 | 2;
  resource?: string;
  action?: string;
  sid?: string | null;
  url?: string | null;
  status?: string | null;
  exist?: boolean;
};

function verdictBody(o: VerdictOverrides) {
  return {
    logId: 'x',
    success: true,
    statusCode: 201,
    error: null,
    payload: [
      {
        permission: o.permission,
        resource: o.resource ?? 'system',
        action: o.action ?? 'create',
        reasoning: 'matrix test',
        summary: 'test',
        provider: 'claude',
        sid: o.sid === undefined ? 'tc_stepup_x' : o.sid,
        url:
          o.url === undefined ? 'https://auth.example/?sid=tc_stepup_x' : o.url,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        exist: o.exist ?? false,
        status: o.status === undefined ? 'pending' : o.status,
      },
    ],
  };
}

/** Files under `~/.transcodes/state/` — must stay empty across a gate run. */
function stateFiles(home: string): string[] {
  try {
    return readdirSync(path.join(home, '.transcodes', 'state'));
  } catch {
    return [];
  }
}

describe('evaluate decision matrix (t3 §3)', () => {
  let server: Server | undefined;
  let home = '';
  const origHome = process.env.HOME;
  const origUrl = process.env.TRANSCODES_BACKEND_URL;

  beforeEach(() => {
    home = makeHomeSandbox('t3-matrix-');
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    process.env.HOME = origHome;
    if (origUrl === undefined) {
      delete process.env.TRANSCODES_BACKEND_URL;
    } else {
      process.env.TRANSCODES_BACKEND_URL = origUrl;
    }
    rmSync(home, { recursive: true, force: true });
  });

  async function gate(body: unknown, status = 200) {
    const backend = await startJsonBackend(() => ({ status, body }));
    server = backend.server;
    process.env.TRANSCODES_BACKEND_URL = backend.url;
    const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
    return evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /tmp/x' },
      cwd: '/tmp',
    });
  }

  it('permission 0 → hard deny (step-up cannot help)', async () => {
    const decision = await gate(verdictBody({ permission: 0 }));
    assert.equal(decision.kind, 'block-by-policy');
    assert.deepEqual(stateFiles(home), []);
  });

  it('permission 1 → pass without step-up', async () => {
    const decision = await gate(
      verdictBody({ permission: 1, resource: 'gmail', action: 'read' }),
    );
    assert.equal(decision.kind, 'proceed-by-policy');
    if (decision.kind !== 'proceed-by-policy') return;
    assert.equal(decision.resource, 'gmail');
    assert.equal(decision.action, 'read');
    assert.deepEqual(stateFiles(home), []);
  });

  it('already verified → pass (backend sends it as permission 1, not 2+verified)', async () => {
    // The shape a reused VERIFIED coordinate actually takes on the wire:
    // permission downgraded to 1, no sid/url. The client needs no verified
    // branch of its own — that is the whole point of the t3 teardown.
    const decision = await gate(
      verdictBody({
        permission: 1,
        status: 'verified',
        exist: true,
        sid: null,
        url: null,
      }),
    );
    assert.equal(decision.kind, 'proceed-by-policy');
    assert.deepEqual(stateFiles(home), []);
  });

  it('permission 2 + unverified → challenge deny carrying the session', async () => {
    const decision = await gate(verdictBody({ permission: 2 }));
    assert.equal(decision.kind, 'block-stepup-challenged');
    if (decision.kind !== 'block-stepup-challenged') return;
    assert.equal(decision.sid, 'tc_stepup_x');
    assert.match(decision.browserUrl, /^https:\/\/auth\.example\//);
    assert.deepEqual(stateFiles(home), []);
  });

  it('rejected → terminal skip, not a retry loop', async () => {
    const decision = await gate(
      verdictBody({ permission: 2, status: 'rejected', exist: true }),
    );
    assert.equal(decision.kind, 'block-stepup-rejected');
    assert.deepEqual(stateFiles(home), []);
  });

  it('fail-closed: backend unreachable → step-up side, never allow', async () => {
    const backend = await startUnreachableBackend();
    server = backend.server;
    process.env.TRANSCODES_BACKEND_URL = backend.url;
    const { evaluatePreToolUse } = await import('../src/stepup/evaluate.js');
    const decision = await evaluatePreToolUse({
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /tmp/x' },
      cwd: '/tmp',
    });
    assert.equal(decision.kind, 'block-stepup-create-failed');
    assert.deepEqual(stateFiles(home), []);
  });

  it('fail-closed: malformed answer → step-up side, never allow', async () => {
    const decision = await gate({ nonsense: true });
    assert.equal(decision.kind, 'block-stepup-create-failed');
    assert.deepEqual(stateFiles(home), []);
  });

  it('fail-closed: non-2xx → step-up side, never allow', async () => {
    const decision = await gate({ error: 'nope' }, 500);
    assert.equal(decision.kind, 'block-stepup-create-failed');
    assert.deepEqual(stateFiles(home), []);
  });
});
