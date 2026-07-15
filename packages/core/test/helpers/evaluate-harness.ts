/**
 * Shared harness for evaluate-path tests: fake member JWT, HOME sandbox with
 * `~/.transcodes/{state,config.json}`, and local JSON backends. Extracted from
 * evaluate-browser-dedupe.test.ts / evaluate-create-failed.test.ts so a token
 * shape or state-dir layout change lands in one place. Not matched by the
 * `test/*.test.ts` runner glob.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function fakeMemberJwt(): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    oid: 'org-test',
    pid: 'proj-test',
    mid: 'member-test',
    aud: 'transcodes-mcp',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.x`;
}

/**
 * mkdtemp a HOME with `~/.transcodes/{state,config.json}` (fake member token)
 * and point `process.env.HOME` at it. Returns the dir; the caller restores
 * HOME and `rmSync`s it in afterEach.
 */
export function makeHomeSandbox(prefix: string): string {
  const home = mkdtempSync(path.join(tmpdir(), prefix));
  process.env.HOME = home;
  const dir = path.join(home, '.transcodes');
  mkdirSync(path.join(dir, 'state'), { recursive: true });
  writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ token: fakeMemberJwt() }),
  );
  return home;
}

/** Local backend answering every request with the handler's JSON. */
export async function startJsonBackend(
  handle: () => { status: number; body: unknown },
): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    const { status, body } = handle();
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('backend listen failed');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

/**
 * A live listener that destroys every connection before responding — a
 * deterministic network failure (fetch rejects → envelope status 0). Unlike
 * the listen-then-close dead-port pattern, the port stays bound to us, so
 * another process can never rebind it mid-test.
 */
export async function startUnreachableBackend(): Promise<{
  server: Server;
  url: string;
}> {
  const server = createServer(() => {});
  server.on('connection', (socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('backend listen failed');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}
