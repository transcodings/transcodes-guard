/**
 * Per-test isolated world for e2e hook runs.
 *
 * Every test gets its own temp HOME (so `~/.transcodes/{config.json,state/}`
 * resolves inside it), a PATH shim dir whose fake `xdg-open`/`open` record
 * browser launches instead of opening tabs, and a child env constructed FROM
 * SCRATCH — never a spread of `process.env` — so a dev machine's
 * `environment=dev`, real `TRANSCODES_BACKEND_URL`, or `CLAUDE_PLUGIN_DATA`
 * (a legacy migration source) can never leak into the hook process.
 *
 * Real-backend misfire guard: `env()` throws unless the backend URL is a
 * loopback `http://127.0.0.1:<port>` — the env-var override is total
 * (core/src/stepup/config.ts), so a mock URL being structurally mandatory
 * means no harness code path can reach https://api.transcodesapis.com.
 *
 * NOTE (v3): Guard v3 removed the browser-lock file — `openBrowser`
 * (core/src/stepup/gate.ts) spawns the OS opener directly. The PATH shim
 * replaces the old "pre-empt the fingerprint lock" suppression technique.
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type FakeJwtClaims = {
  oid?: string;
  pid?: string;
  mid?: string;
  exp?: number;
  aud?: string[];
};

/** alg:none JWT, 3 non-empty segments, claims per core/src/stepup/jwt.ts. */
export function makeFakeJwt(overrides: FakeJwtClaims = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      oid: overrides.oid ?? 'org-e2e',
      pid: overrides.pid ?? 'proj-e2e',
      mid: overrides.mid ?? 'member-e2e',
      exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 3600,
      aud: overrides.aud ?? ['transcodes-mcp'],
    }),
  ).toString('base64url');
  return `${header}.${payload}.e2e`;
}

const SHIM_SOURCE = `#!/bin/sh
# e2e browser shim — records the launch instead of opening a tab.
echo "$@" >> "$BROWSER_LOG"
exit 0
`;

export type TestWorld = {
  home: string;
  binDir: string;
  browserLog: string;
  writeToken(claims?: FakeJwtClaims): string;
  stateFiles(): string[];
  browserLaunches(): string[];
  /**
   * The shim runs as a DETACHED grandchild (`openBrowser` unrefs it), so the
   * hook can exit before the log line lands. Poll up to `timeoutMs` for
   * `count` entries; returns whatever is present at the deadline — callers
   * assert on the result either way (a negative check passes `count` it
   * expects never to be reached and a short timeout).
   */
  waitForBrowserLaunches(count: number, timeoutMs?: number): Promise<string[]>;
  env(backendUrl: string): NodeJS.ProcessEnv;
  dispose(): void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:\d+$/;

export function makeWorld(): TestWorld {
  const home = mkdtempSync(join(tmpdir(), 'transcodes-e2e-'));
  const binDir = join(home, 'bin');
  const browserLog = join(home, 'browser-launches.log');
  mkdirSync(binDir);
  for (const opener of ['xdg-open', 'open']) {
    const shim = join(binDir, opener);
    writeFileSync(shim, SHIM_SOURCE);
    chmodSync(shim, 0o755);
  }

  return {
    home,
    binDir,
    browserLog,

    writeToken(claims?: FakeJwtClaims): string {
      const token = makeFakeJwt(claims);
      const dir = join(home, '.transcodes');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ token }), { mode: 0o600 });
      return token;
    },

    stateFiles(): string[] {
      try {
        return readdirSync(join(home, '.transcodes', 'state'));
      } catch {
        return [];
      }
    },

    browserLaunches(): string[] {
      try {
        return readFileSync(browserLog, 'utf8')
          .split('\n')
          .filter((line) => line.length > 0);
      } catch {
        return [];
      }
    },

    async waitForBrowserLaunches(count: number, timeoutMs = 3000): Promise<string[]> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const launches = this.browserLaunches();
        if (launches.length >= count || Date.now() >= deadline) return launches;
        await sleep(25);
      }
    },

    env(backendUrl: string): NodeJS.ProcessEnv {
      if (!LOOPBACK_URL.test(backendUrl)) {
        throw new Error(
          `e2e misfire guard: backend URL must be loopback http://127.0.0.1:<port>, got "${backendUrl}"`,
        );
      }
      // Built from scratch on purpose — see file header.
      //
      // The running node's own bin dir is on PATH because the MCP server's
      // `simulate_hook_invocation` spawns bare `node` (resolved via PATH), not
      // `process.execPath`. Hardcoding /usr/bin only works where node happens
      // to live there — not under nvm/fnm, and not on CI, where
      // actions/setup-node installs to /opt/hostedtoolcache. Derive it instead
      // of guessing.
      return {
        HOME: home,
        PATH: `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin`,
        TRANSCODES_BACKEND_URL: backendUrl,
        BROWSER_LOG: browserLog,
        LANG: 'C.UTF-8',
      };
    },

    dispose(): void {
      rmSync(home, { recursive: true, force: true });
    },
  };
}
