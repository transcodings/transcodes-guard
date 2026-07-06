/**
 * Console browser session — auth-host passkey / TOTP self-service.
 *
 * Same backend flow as SDK `redirectToConsole()` and MCP `get_console_url`:
 * POST /v1/auth/temp-session/console/session.
 */
import { spawn } from 'node:child_process';
import { request } from './client.js';
import { loadStepupConfig, type StepupConfig } from './config.js';
import { createConsoleBrowserSession } from './session.js';
import { resolveToken } from './token-store.js';

export const CONSOLE_SESSION_COMMENT =
  'Manage your authentication methods (passkeys, TOTP, security keys)';

export type ConsoleSessionResult =
  | {
      ok: true;
      sid: string;
      browserUrl: string;
      expiresAt?: string;
      launched: boolean;
    }
  | {
      ok: false;
      reason: 'no-token' | 'create-failed' | 'error';
      detail?: string;
    };

export type MemberProfileSummary = {
  name?: string;
  email?: string;
  role?: string;
};

function openBrowser(url: string): void {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(opener, args, {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Caller prints browserUrl when the OS opener is unavailable.
  }
}

function extractMemberProfile(data: unknown): MemberProfileSummary | null {
  if (!data || typeof data !== 'object') return null;
  const payload = (data as { payload?: unknown }).payload;
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const first = payload[0];
  if (!first || typeof first !== 'object') return null;
  const rec = first as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name.trim() : '';
  const email = typeof rec.email === 'string' ? rec.email.trim() : '';
  const role = typeof rec.role === 'string' ? rec.role.trim() : '';
  if (!name && !email && !role) return null;
  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(role ? { role } : {}),
  };
}

/** Fetch name/email/role for the token's member (best-effort). */
export async function fetchMemberProfile(
  config: StepupConfig,
): Promise<MemberProfileSummary | null> {
  const envelope = await request(config, {
    method: 'GET',
    path: '/auth/member',
    query: {
      project_id: config.projectId,
      member_id: config.memberId,
    },
  });
  if (!envelope.ok) return null;
  return extractMemberProfile(envelope.data);
}

/**
 * Mint a console-mode step-up session and optionally open the auth host in
 * the system browser. Used by `transcodes console` and the CLI dashboard.
 */
export async function openConsoleSession(options?: {
  openBrowser?: boolean;
  comment?: string;
}): Promise<ConsoleSessionResult> {
  if (!resolveToken().token) {
    return { ok: false, reason: 'no-token' };
  }

  let config: StepupConfig;
  try {
    config = loadStepupConfig();
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let created;
  try {
    created = await createConsoleBrowserSession(config, {
      comment: options?.comment ?? CONSOLE_SESSION_COMMENT,
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'create-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!created.envelope.ok || !created.sid || !created.browserUrl) {
    return {
      ok: false,
      reason: 'create-failed',
      detail: `backend rejected console session (status ${created.envelope.status})`,
    };
  }

  const shouldOpen = options?.openBrowser !== false;
  if (shouldOpen) {
    openBrowser(created.browserUrl);
  }

  return {
    ok: true,
    sid: created.sid,
    browserUrl: created.browserUrl,
    expiresAt: created.expiresAt,
    launched: shouldOpen,
  };
}
