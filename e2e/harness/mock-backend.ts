/**
 * Per-test mock of the Transcodes backend for e2e hook runs.
 *
 * Speaks the real `POST /v1/guard/evaluate` wire contract: the nestjs DTO is
 * flat and the `{payload:[…]}` single-element-array wrapper is injected by
 * `@ApiArrayNormalizedResponse` — so a verdict here is emitted as
 * `{ payload: [ {flat fields} ] }` (what `rbac-check.ts` parses via
 * `data.payload[0]`).
 *
 * Ephemeral port only (`listen(0)`) — a fixed port caused a stale-mock
 * incident in the PR #154 ad-hoc session. Every request is recorded BEFORE
 * routing so unexpected client traffic fails an assertion instead of hiding.
 */
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';

export type RecordedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  body: unknown;
};

/** Flat evaluate DTO — full fidelity with the backend response shape. */
export type VerdictPayload = {
  decision?: 'deny' | 'allow' | 'stepup';
  permission: 0 | 1 | 2;
  resource: string;
  action: string;
  reasoning?: string | null;
  summary?: string | null;
  provider?: string | null;
  consume_in_hook?: boolean;
  sid?: string | null;
  url?: string | null;
  expires_at?: string | null;
  exist?: boolean;
  status?: 'pending' | 'verified' | 'rejected' | null;
};

export type MockRoute =
  | { kind: 'verdict'; payload: VerdictPayload }
  | { kind: 'http-error'; status: number; body?: unknown };

const EVALUATE_PATH = '/v1/guard/evaluate';

export class MockBackend {
  readonly requests: RecordedRequest[] = [];
  private readonly evaluateQueue: MockRoute[] = [];
  private readonly sockets = new Set<Socket>();

  private constructor(
    private readonly server: Server,
    readonly url: string,
  ) {}

  static async start(): Promise<MockBackend> {
    let mock!: MockBackend;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let body: unknown;
        try {
          body = rawBody ? JSON.parse(rawBody) : undefined;
        } catch {
          body = undefined;
        }
        mock.requests.push({
          method: req.method ?? '',
          path: req.url ?? '',
          headers: req.headers,
          rawBody,
          body,
        });
        mock.route(req.method ?? '', req.url ?? '', res);
      });
    });
    server.on('connection', (socket) => {
      mock.sockets.add(socket);
      socket.on('close', () => mock.sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address !== 'object') {
      throw new Error('mock backend: could not resolve listen address');
    }
    mock = new MockBackend(server, `http://127.0.0.1:${address.port}`);
    return mock;
  }

  private route(method: string, path: string, res: import('node:http').ServerResponse): void {
    if (method === 'POST' && path === EVALUATE_PATH) {
      const next = this.evaluateQueue.shift();
      if (!next) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'mock: no route enqueued' }));
        return;
      }
      if (next.kind === 'http-error') {
        res.writeHead(next.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(next.body ?? { message: `mock: http ${next.status}` }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ payload: [next.payload] }));
      return;
    }
    // Unknown path — still recorded above, so assertOnlyEvaluateTraffic sees it.
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'mock: unexpected path' }));
  }

  enqueueEvaluate(route: MockRoute): void {
    this.evaluateQueue.push(route);
  }

  /** Sugar: enqueue a 200 verdict. */
  onEvaluate(payload: VerdictPayload): void {
    this.enqueueEvaluate({ kind: 'verdict', payload });
  }

  evaluateRequests(): RecordedRequest[] {
    return this.requests.filter((r) => r.path === EVALUATE_PATH);
  }

  nonEvaluateRequests(): RecordedRequest[] {
    return this.requests.filter((r) => r.path !== EVALUATE_PATH);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

/**
 * A7 (rescoped): the hook path's ONLY outbound request is POST /v1/guard/evaluate
 * — no decision-audit, no telemetry, no poll. Call in every scenario teardown.
 */
export function assertOnlyEvaluateTraffic(mock: MockBackend): void {
  const extra = mock.nonEvaluateRequests();
  if (extra.length > 0) {
    const lines = extra.map((r) => `${r.method} ${r.path}`).join(', ');
    throw new Error(`hook path sent non-evaluate traffic: ${lines}`);
  }
}
