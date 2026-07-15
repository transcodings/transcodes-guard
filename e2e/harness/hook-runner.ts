/**
 * Spawns the committed dist hook bundles as child processes — the same
 * artifact a real host executes (`node plugins/<host>/dist/hooks/<hook>.js`).
 *
 * stdout and stderr are captured SEPARATELY (never merged — the deny JSON
 * travels on stdout, the human tag line on stderr, and conflating them is
 * exactly what the CI inline smokes' `2>&1` habit gets wrong).
 *
 * `E2E_PLUGINS_ROOT` overrides the plugins dir — used by the one-time
 * known-defective-build red verification (run the suite against an old
 * worktree's committed dist).
 *
 * Import rule: this harness must not import from `packages/*` or `plugins/*`
 * — it tests the committed bundles from the outside.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type HostId = 'claude-code' | 'codex' | 'cursor' | 'antigravity';

export const ALL_HOSTS: readonly HostId[] = [
  'claude-code',
  'codex',
  'cursor',
  'antigravity',
] as const;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function pluginsRoot(): string {
  return process.env.E2E_PLUGINS_ROOT ?? join(REPO_ROOT, 'plugins');
}

export function hookPath(host: HostId, hook: string): string {
  return join(pluginsRoot(), host, 'dist', 'hooks', `${hook}.js`);
}

// Fail loudly at load time when the committed dist is missing entirely.
for (const host of ALL_HOSTS) {
  const entry = hookPath(host, 'pre-tool-use');
  if (!existsSync(entry)) {
    throw new Error(`missing dist hook entry: ${entry} — run \`npm run build:plugin\` first`);
  }
}

export type HookRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** JSON.parse(stdout) with raw output embedded in the failure message. */
  json(): unknown;
};

/**
 * Hook entry basenames. The prompt hook's filename diverges by host —
 * `user-prompt-submit` (Claude Code / Codex) vs `before-submit-prompt`
 * (Cursor) — and Antigravity has no prompt hook at all (its PreInvocation
 * fires before every model call, a different contract). Use `promptHook()`
 * rather than hardcoding a name.
 */
export type HookName =
  | 'pre-tool-use'
  | 'stop'
  | 'user-prompt-submit'
  | 'before-submit-prompt';

/**
 * The prompt-hook entry for a host, or null when the host has none.
 * Antigravity is null on purpose — PreInvocation is not a prompt hook.
 */
export function promptHook(host: HostId): HookName | null {
  switch (host) {
    case 'claude-code':
    case 'codex':
      return 'user-prompt-submit';
    case 'cursor':
      return 'before-submit-prompt';
    case 'antigravity':
      return null;
  }
}

export type RunHookOptions = {
  host: HostId;
  hook: HookName;
  stdin: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs?: number;
};

export async function runHook(opts: RunHookOptions): Promise<HookRunResult> {
  const entry = hookPath(opts.host, opts.hook);
  const child = spawn(process.execPath, [entry], {
    env: opts.env,
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
  child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

  child.stdin.write(opts.stdin);
  child.stdin.end();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, opts.timeoutMs ?? 15_000);

  const exitCode = await new Promise<number | null>((resolvePromise) => {
    // `close`, not `exit` — stdio must be fully flushed before we read it.
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise(code);
    });
  });

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  return {
    stdout,
    stderr,
    exitCode,
    timedOut,
    json(): unknown {
      try {
        return JSON.parse(stdout);
      } catch {
        throw new Error(
          `hook stdout is not JSON.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
        );
      }
    },
  };
}
