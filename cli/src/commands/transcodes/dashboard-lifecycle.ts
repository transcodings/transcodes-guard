/**
 * Background lifecycle for the local CLI dashboard.
 *
 * Client (`transcodes` / install): ensureDashboard → probe or spawn daemon →
 * open browser → return (shell free).
 * Daemon (`transcodes dashboard --daemon`): serveDashboard only.
 * Stop: `transcodes stop`.
 */

import { execFile, spawn } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { dataDir } from '@transcodes-guard/core/paths';
import {
  DASHBOARD_HOST,
  DASHBOARD_PORT_ATTEMPTS,
  DEFAULT_DASHBOARD_PORT,
  openDashboardBrowser,
  serveDashboardHttp,
} from './dashboard.js';
import { t } from './i18n.js';

const DASHBOARD_MARKER = 'transcodes-dashboard';
const HEALTH_PATH = '/health';
const execFileAsync = promisify(execFile);

type PidRecord = {
  pid: number;
  port: number;
};

function pidFilePath(): string {
  return path.join(dataDir(), 'dashboard.pid');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPidRecord(): PidRecord | null {
  try {
    const raw = readFileSync(pidFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PidRecord>;
    if (
      typeof parsed.pid === 'number' &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.port === 'number' &&
      Number.isInteger(parsed.port) &&
      parsed.port > 0
    ) {
      return { pid: parsed.pid, port: parsed.port };
    }
  } catch {
    // missing / corrupt
  }
  return null;
}

function writePidRecord(record: PidRecord): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(pidFilePath(), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function clearPidRecord(): void {
  try {
    unlinkSync(pidFilePath());
  } catch {
    // already gone
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** GET /health on loopback; true when this is our dashboard. */
function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: DASHBOARD_HOST,
        port,
        path: HEALTH_PATH,
        timeout: 500,
      },
      (res) => {
        const marker = res.headers['x-transcodes-dashboard'];
        res.resume();
        resolve(res.statusCode === 200 && marker === DASHBOARD_MARKER);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findRunningDashboard(
  preferred: number,
): Promise<{ port: number; url: string } | null> {
  const record = readPidRecord();
  if (record && isProcessAlive(record.pid)) {
    if (await probeHealth(record.port)) {
      return {
        port: record.port,
        url: `http://${DASHBOARD_HOST}:${record.port}/`,
      };
    }
  }

  for (let i = 0; i < DASHBOARD_PORT_ATTEMPTS; i++) {
    const port = preferred + i;
    if (await probeHealth(port)) {
      return { port, url: `http://${DASHBOARD_HOST}:${port}/` };
    }
  }
  return null;
}

function spawnDaemon(port: number): void {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error('cannot resolve CLI entry path to spawn dashboard daemon');
  }

  mkdirSync(dataDir(), { recursive: true });
  const logPath = path.join(dataDir(), 'dashboard.log');
  const logFd = openSync(logPath, 'a');

  try {
    const child = spawn(
      process.execPath,
      [entry, 'dashboard', '--daemon', '--port', String(port)],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: process.env,
      },
    );
    child.unref();
  } finally {
    try {
      closeSync(logFd);
    } catch {
      // ignore
    }
  }
}

async function killPortListener(port: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `$p=(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess; if($p){ Stop-Process -Id $p -Force }`,
        ],
        { timeout: 5000 },
      );
      return;
    }
    const { stdout } = await execFileAsync(
      'lsof',
      ['-ti', `tcp:${port}`, '-sTCP:LISTEN'],
      { timeout: 5000 },
    );
    for (const token of stdout.trim().split(/\s+/)) {
      const pid = Number(token);
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // port free or tools unavailable
  }
}

/**
 * Run the HTTP server in this process (daemon mode). Does not return until
 * SIGINT/SIGTERM.
 */
export async function serveDashboard(options: {
  port?: number;
}): Promise<void> {
  const preferred = options.port ?? DEFAULT_DASHBOARD_PORT;
  const bound = await serveDashboardHttp({ port: preferred });
  writePidRecord({ pid: process.pid, port: bound.port });

  const cleanup = () => clearPidRecord();
  process.once('exit', cleanup);

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const onSignal = () => {
      if (shuttingDown) {
        cleanup();
        process.exit(0);
      }
      shuttingDown = true;
      bound.server.closeAllConnections?.();
      bound.server.close(() => {
        cleanup();
        resolve();
      });
      setTimeout(() => {
        cleanup();
        process.exit(0);
      }, 1500).unref();
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}

/** Kill any running dashboard daemon (no user-facing output). */
async function killRunningDashboard(preferred: number): Promise<void> {
  const record = readPidRecord();
  if (record && isProcessAlive(record.pid)) {
    try {
      process.kill(record.pid, 'SIGTERM');
      for (let i = 0; i < 20; i++) {
        await sleep(100);
        if (!isProcessAlive(record.pid)) break;
      }
      if (isProcessAlive(record.pid)) {
        process.kill(record.pid, 'SIGKILL');
      }
    } catch {
      // already gone
    }
  }

  for (let i = 0; i < DASHBOARD_PORT_ATTEMPTS; i++) {
    const port = preferred + i;
    if (!(await probeHealth(port))) continue;
    await killPortListener(port);
  }

  clearPidRecord();
}

/**
 * Start the dashboard from this CLI binary, open the browser, return.
 * Always restarts the daemon so a fresh local `npm run build` is picked up.
 */
export async function ensureDashboard(options: {
  port?: number;
  open?: boolean;
}): Promise<void> {
  const preferred = options.port ?? DEFAULT_DASHBOARD_PORT;
  const open = options.open !== false;

  await killRunningDashboard(preferred);
  spawnDaemon(preferred);

  let running: { port: number; url: string } | null = null;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    running = await findRunningDashboard(preferred);
    if (running) break;
  }

  if (!running) {
    throw new Error(
      `could not start dashboard on ${DASHBOARD_HOST}:${preferred}.\n` +
        `  Check ${path.join(dataDir(), 'dashboard.log')} or run:\n` +
        `    transcodes dashboard --daemon --port ${preferred}\n` +
        '  Stop a stuck instance with:  transcodes stop',
    );
  }

  process.stdout.write(
    `${t('dashboardOpened', { url: running.url })}\n` +
      `  ${t('dashboardHowToUse')}\n` +
      `  ${t('dashboardStopHint')}\n` +
      '\n' +
      `  ${t('dashboardOpenFallback')}\n`,
  );

  if (open) {
    openDashboardBrowser(running.url);
  }
}

/** Stop the background dashboard daemon. */
export async function stopDashboard(): Promise<void> {
  const preferred = readPidRecord()?.port ?? DEFAULT_DASHBOARD_PORT;
  const record = readPidRecord();
  const wasRunning =
    (record !== null && isProcessAlive(record.pid)) ||
    (await findRunningDashboard(preferred)) !== null;

  await killRunningDashboard(preferred);

  process.stdout.write(
    wasRunning ? `${t('dashboardStopped')}\n` : `${t('dashboardNotRunning')}\n`,
  );
}
