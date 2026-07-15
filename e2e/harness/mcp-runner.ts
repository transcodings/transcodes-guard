/**
 * Drives the committed MCP stdio bundle (`plugins/<host>/dist/src/stdio.js`)
 * over JSON-RPC — the same artifact a host launches as its MCP server.
 *
 * Deliberately hand-rolled rather than using `@modelcontextprotocol/sdk`'s
 * client: the harness must not import from `packages/*` or `plugins/*` (it
 * tests the bundles from the outside), and pulling the SDK in would couple the
 * test to the same dependency the bundle inlines. The protocol surface we need
 * is three messages — `initialize`, `notifications/initialized`, `tools/call` —
 * so a ~40-line framer costs less than the coupling.
 *
 * Framing is newline-delimited JSON on stdio, per the MCP stdio transport.
 * stderr is captured separately and exposed for diagnosis (the server writes
 * `transcodes-guard-mcp: stdio transport ready` there on boot).
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HostId } from './hook-runner.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function stdioPath(host: HostId): string {
  const root = process.env.E2E_PLUGINS_ROOT ?? join(REPO_ROOT, 'plugins');
  return join(root, host, 'dist', 'src', 'stdio.js');
}

/** MCP `tools/call` result — `content` plus the error flag. */
export type ToolCallResult = {
  content: { type: string; text?: string }[];
  isError?: boolean;
  /** JSON.parse of the first text block, for tools that return JSON. */
  json<T = unknown>(): T;
};

type PendingResolver = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export class McpRunner {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, PendingResolver>();
  private readonly stderrChunks: string[] = [];

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  /**
   * Spawn the bundle and complete the MCP handshake.
   *
   * `env` must come from `TestWorld.env()` — that is what keeps the child on a
   * loopback backend and a temp HOME. There is no default: an MCP server
   * inheriting the dev machine's env is exactly the misfire the harness exists
   * to make impossible.
   */
  static async start(host: HostId, env: NodeJS.ProcessEnv): Promise<McpRunner> {
    const entry = stdioPath(host);
    if (!existsSync(entry)) {
      throw new Error(`missing dist MCP entry: ${entry} — run \`npm run build:plugin\` first`);
    }

    const child = spawn(process.execPath, [entry], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const runner = new McpRunner(child);

    child.stdout.on('data', (c: Buffer) => runner.onStdout(c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => runner.stderrChunks.push(c.toString('utf8')));
    child.on('error', (err) => runner.failAll(err));
    child.on('close', () => runner.failAll(new Error('MCP server exited')));

    await runner.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'transcodes-guard-e2e', version: '0.0.0' },
    });
    runner.notify('notifications/initialized');
    return runner;
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl === -1) return;
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;

      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // Not a JSON-RPC frame — ignore rather than crash the suite.
      }
      if (typeof msg.id !== 'number') continue; // notification from the server
      const waiter = this.pending.get(msg.id);
      if (!waiter) continue;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message ?? 'MCP error'));
      else waiter.resolve(msg.result);
    }
  }

  private failAll(err: Error): void {
    for (const [, waiter] of this.pending) waiter.reject(err);
    this.pending.clear();
  }

  private notify(method: string, params?: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private request(method: string, params?: unknown, timeoutMs = 20_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms.\n--- stderr ---\n${this.stderr()}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /** Call a registered tool by its wire name (e.g. `tc_simulate_hook_invocation`). */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const content = result.content ?? [];
    return {
      content,
      isError: result.isError,
      json<T = unknown>(): T {
        const text = content.find((c) => c.type === 'text')?.text ?? '';
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new Error(`tool ${name} did not return JSON.\n--- text ---\n${text}`);
        }
      },
    };
  }

  /** Names of every registered tool — used to pin the built-in set. */
  async listToolNames(): Promise<string[]> {
    const result = (await this.request('tools/list')) as { tools?: { name: string }[] };
    return (result.tools ?? []).map((t) => t.name);
  }

  stderr(): string {
    return this.stderrChunks.join('');
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    await new Promise<void>((resolvePromise) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return resolvePromise();
      this.child.once('close', () => resolvePromise());
    });
  }
}
