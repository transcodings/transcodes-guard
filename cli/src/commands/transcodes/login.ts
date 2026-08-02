import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import {
  DEFAULT_BACKEND_URL,
  parseMemberAccessToken,
  writeTokenToFile,
} from '@transcodes-guard/core/stepup';
import { t } from './i18n.js';

const REQUEST_TIMEOUT_MS = 30_000;

type LoginOptions = {
  label: string;
  open: boolean;
};

type CliSessionCreated = {
  sid: string;
  url: string;
  expires_at: string;
  interval: number;
};

type CliTokenPoll = {
  status: 'pending' | 'authorized';
  token?: string;
  label?: string;
};

type ApiEnvelope<T> = {
  success?: boolean;
  payload?: T[];
  error?: string;
  message?: string;
};

class TransientPollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientPollError';
  }
}

class FatalPollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalPollError';
  }
}

function parseOptions(args: string[]): LoginOptions {
  let label = `transcodes-${os.hostname() || 'cli'}`;
  let open = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-l' || arg === '--label') {
      const value = args[++i]?.trim();
      if (!value) {
        throw new Error('missing label. Usage: transcodes login [-l <label>]');
      }
      label = value;
    } else if (arg === '--no-open') {
      open = false;
    } else {
      throw new Error(
        `unknown flag "${arg}". Usage: transcodes login [-l <label>] [--no-open]`,
      );
    }
  }

  return { label, open };
}

function openBrowser(url: string): boolean {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(opener, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function apiBaseV1(): string {
  const backend =
    process.env.TRANSCODES_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL;
  return `${backend.replace(/\/$/, '')}/v1`;
}

async function postJson<T>(
  path: string,
  body: Record<string, string>,
): Promise<{ status: number; envelope: ApiEnvelope<T> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiBaseV1()}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let envelope: ApiEnvelope<T>;
    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
      throw new TransientPollError(
        `CLI authorization response was not JSON (${response.status})`,
      );
    }
    return { status: response.status, envelope };
  } catch (error) {
    if (error instanceof TransientPollError) throw error;
    const aborted =
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError');
    throw new TransientPollError(
      aborted
        ? 'CLI authorization request timed out'
        : error instanceof Error
          ? error.message
          : 'CLI authorization request failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function createSession(
  body: Record<string, string>,
): Promise<CliSessionCreated> {
  const { status, envelope } = await postJson<CliSessionCreated>(
    '/auth/temp-session/cli/session',
    body,
  );
  const value = envelope.payload?.[0];
  if (status < 200 || status >= 300 || !value) {
    throw new Error(
      envelope.message ||
        envelope.error ||
        `CLI authorization request failed (${status})`,
    );
  }
  return value;
}

async function pollToken(params: {
  sid: string;
  verifier: string;
}): Promise<CliTokenPoll> {
  const { status, envelope } = await postJson<CliTokenPoll>(
    `/auth/temp-session/cli/session/${encodeURIComponent(params.sid)}/token`,
    { code_verifier: params.verifier },
  );

  if (status === 404) {
    throw new FatalPollError(
      envelope.message ||
        envelope.error ||
        'CLI authorization session expired or was already used',
    );
  }
  if (status === 403) {
    throw new FatalPollError(
      envelope.message ||
        envelope.error ||
        'CLI authorization verifier was rejected',
    );
  }
  if (status >= 500 || status === 0) {
    throw new TransientPollError(
      envelope.message ||
        envelope.error ||
        `CLI authorization temporary failure (${status})`,
    );
  }

  const value = envelope.payload?.[0];
  if (status < 200 || status >= 300 || !value) {
    throw new FatalPollError(
      envelope.message ||
        envelope.error ||
        `CLI authorization request failed (${status})`,
    );
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForToken(params: {
  sid: string;
  verifier: string;
  expiresAt: string;
  interval: number;
  signal?: AbortSignal;
}): Promise<CliTokenPoll> {
  const deadline = new Date(params.expiresAt).getTime();
  if (!Number.isFinite(deadline)) {
    throw new Error('CLI authorization session has an invalid expiry');
  }

  while (Date.now() < deadline) {
    if (params.signal?.aborted) {
      throw new Error('CLI authorization cancelled');
    }
    try {
      const result = await pollToken({
        sid: params.sid,
        verifier: params.verifier,
      });
      if (result.status === 'authorized' && result.token) return result;
    } catch (error) {
      if (error instanceof FatalPollError) throw error;
      // Transient network/5xx: keep polling until the session deadline.
    }
    await delay(Math.max(1, params.interval) * 1_000);
  }
  throw new Error('CLI authorization timed out');
}

export type RunCliLoginOptions = {
  /** Defaults to `transcodes-{hostname}`. */
  label?: string;
  /** Open the browser automatically (default true). */
  open?: boolean;
  /** When false, skip stdout prompts (dashboard / programmatic use). */
  quiet?: boolean;
  /** Cancels polling so a newer dashboard login attempt can replace this one. */
  signal?: AbortSignal;
};

export type BegunCliLogin = {
  completion: Promise<{ label: string }>;
};

/**
 * Create a browser login session and return as soon as the browser is opened.
 * The dashboard uses this so closing the auth tab never leaves its Login
 * button blocked until the server-side session expires.
 */
export async function beginCliLogin(
  options: RunCliLoginOptions = {},
): Promise<BegunCliLogin> {
  const label = options.label?.trim() || `transcodes-${os.hostname() || 'cli'}`;
  const open = options.open !== false;
  const quiet = options.quiet === true;

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const session = await createSession({
    code_challenge: challenge,
    label,
  });

  // Never print session.url — it embeds sid. Open the browser and guide the user.
  if (!quiet) {
    process.stdout.write(`${t('loginPleaseSignIn')}\n`);
    if (!open) {
      process.stdout.write(`${t('loginNoOpenHint')}\n`);
    } else if (!openBrowser(session.url)) {
      process.stdout.write(`${t('loginBrowserOpenFailed')}\n`);
    } else {
      process.stdout.write(`${t('loginWaiting')}\n`);
    }
  } else if (open) {
    openBrowser(session.url);
  }

  const completion = (async () => {
    const result = await waitForToken({
      sid: session.sid,
      verifier,
      expiresAt: session.expires_at,
      interval: session.interval,
      signal: options.signal,
    });
    const token = result.token;
    if (!token) throw new Error('CLI authorization completed without a token');

    const savedLabel = result.label || label;
    parseMemberAccessToken(token);
    writeTokenToFile(token, savedLabel);
    if (!quiet) process.stdout.write(`${t('loginTokenSaved')}\n`);
    return { label: savedLabel };
  })();

  return { completion };
}

/**
 * Browser CLI login → persist MAT as the active credential.
 * Shared by the interactive `transcodes login` command.
 */
export async function runCliLogin(
  options: RunCliLoginOptions = {},
): Promise<{ label: string }> {
  const login = await beginCliLogin(options);
  return login.completion;
}

export async function cmdLogin(args: string[]): Promise<void> {
  const options = parseOptions(args);
  await runCliLogin({ label: options.label, open: options.open });
}
