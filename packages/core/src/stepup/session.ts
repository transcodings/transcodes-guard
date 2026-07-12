/**
 * Step-up MFA session — create / poll.
 *
 * Adapted from transcodes-mcp-server/src/tools/stepup.ts. The framework-
 * specific MCP tool wiring is split out (see src/server.ts); this file
 * holds pure async functions usable from both the hook and the server.
 */
import { type Envelope, request } from './client.js';
import type { StepupConfig } from './config.js';

const STEPUP_PATH = '/auth/temp-session/step-up/session';
const CONSOLE_SESSION_PATH = '/auth/temp-session/console/session';

export type CreateStepupArgs = {
  /** One short sentence describing what the user is confirming. */
  summary: string;
  action?: string | undefined;
  resource?: string | undefined;
  member_id?: string | undefined;
  /** @deprecated Use `summary`. Kept for callers that still pass `comment`. */
  comment?: string;
};

export type CreateConsoleSessionArgs = {
  comment?: string;
};

export type CreatedStepupSession = {
  envelope: Envelope;
  /** Parsed when the backend envelope shape matches; undefined otherwise. */
  sid?: string | undefined;
  browserUrl?: string | undefined;
  expiresAt?: string | undefined;
  /** Session mode the backend assigned (stepup/console/signin). */
  mode?: string | undefined;
};

export type PollStepupResult = {
  envelope: Envelope;
  /** pending | verified | rejected | timeout (expired / missing / wait ended). */
  status?: string | undefined;
};

/**
 * Look for a step-up payload object at `envelope.data.payload[0]`.
 * Mirrors the response shape transcodes-mcp-server already relies on.
 */
function readStepupPayload(
  envelope: Envelope,
): Record<string, unknown> | undefined {
  const data = envelope.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }
  const payload = (data as Record<string, unknown>).payload;
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  const first = payload[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    return undefined;
  }
  return first as Record<string, unknown>;
}

function readString(
  rec: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = rec[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** MCP / hook step-up — POST .../step-up/session (mode fixed server-side). */
export async function createStepupSession(
  config: StepupConfig,
  args: CreateStepupArgs,
): Promise<CreatedStepupSession> {
  const summary = (args.summary ?? args.comment)?.trim();
  if (!summary) {
    throw new Error(
      'summary is required — one short sentence describing the action',
    );
  }

  const envelope = await request(config, {
    method: 'POST',
    path: STEPUP_PATH,
    body: {
      project_id: config.projectId,
      member_id: args.member_id ?? config.memberId,
      action: args.action,
      resource: args.resource,
      summary,
    },
  });

  const payload = readStepupPayload(envelope);
  return {
    envelope,
    sid: payload ? readString(payload, 'sid') : undefined,
    browserUrl: payload
      ? (readString(payload, 'url') ??
        readString(payload, 'browser_url') ??
        readString(payload, 'browserUrl'))
      : undefined,
    expiresAt: payload
      ? (readString(payload, 'expiresAt') ?? readString(payload, 'expires_at'))
      : undefined,
    mode: payload ? readString(payload, 'mode') : undefined,
  };
}

/** Console auth-host session — same endpoint as Toolkit `redirectToConsole()`. */
export async function createConsoleBrowserSession(
  config: StepupConfig,
  args: CreateConsoleSessionArgs = {},
): Promise<CreatedStepupSession> {
  const envelope = await request(config, {
    method: 'POST',
    path: CONSOLE_SESSION_PATH,
    body: {
      project_id: config.projectId,
      member_id: config.memberId,
      organization_id: config.organizationId,
      comment: args.comment,
    },
  });

  const payload = readStepupPayload(envelope);
  return {
    envelope,
    sid: payload ? readString(payload, 'sid') : undefined,
    browserUrl: payload
      ? (readString(payload, 'url') ??
        readString(payload, 'browser_url') ??
        readString(payload, 'browserUrl'))
      : undefined,
    expiresAt: payload
      ? (readString(payload, 'expiresAt') ?? readString(payload, 'expires_at'))
      : undefined,
    mode: payload ? readString(payload, 'mode') : undefined,
  };
}

export async function pollStepupSession(
  config: StepupConfig,
  sid: string,
): Promise<PollStepupResult> {
  const trimmed = sid?.trim();
  if (!trimmed) {
    throw new Error('sid is required');
  }
  const envelope = await request(config, {
    method: 'GET',
    path: `${STEPUP_PATH}/${encodeURIComponent(trimmed)}`,
  });
  if (envelope.status === 404) {
    return { envelope, status: 'timeout' };
  }
  const payload = readStepupPayload(envelope);
  return {
    envelope,
    status: payload ? readString(payload, 'status') : undefined,
  };
}

/**
 * Resolve live step-up status by member-scoped RBAC coordinate (MAT auth).
 * Prefer this when the agent has resource/action from the deny payload and
 * may not retain sid.
 */
export async function pollStepupByCoordinate(
  config: StepupConfig,
  coordinate: { resource: string; action: string },
): Promise<PollStepupResult & { sid?: string }> {
  const resource = coordinate.resource?.trim();
  const action = coordinate.action?.trim();
  if (!resource || !action) {
    throw new Error('resource and action are required');
  }
  const q = new URLSearchParams({ resource, action });
  const envelope = await request(config, {
    method: 'GET',
    path: `/guard/step-up/status?${q.toString()}`,
  });
  if (envelope.status === 404) {
    return { envelope, status: 'timeout' };
  }
  const payload = readStepupPayload(envelope);
  const sid = payload ? readString(payload, 'sid') : undefined;
  return {
    envelope,
    status: payload ? readString(payload, 'status') : undefined,
    ...(sid ? { sid } : {}),
  };
}

export type WaitStepupResult = {
  /** Last poll's envelope — useful for diagnostics. */
  envelope: Envelope;
  /** verified = continue work; rejected/not_found/timeout = skip blocked command, continue other work. */
  outcome: 'verified' | 'rejected' | 'not_found' | 'timeout';
  /** Total elapsed time in ms across all polls. */
  elapsedMs: number;
  /** Number of poll requests issued. */
  attempts: number;
  /** Resolved session id (from sid arg or coordinate lookup). */
  sid?: string;
};

export type WaitStepupTarget = {
  sid?: string;
  resource?: string;
  action?: string;
};

/**
 * Block until step-up is verified or the wait window elapses.
 *
 * Prefer `{ resource, action }` (coordinate poll). Optional `sid` skips the
 * coordinate lookup and hits `GET .../session/:sid` directly.
 */
export async function pollStepupSessionWait(
  config: StepupConfig,
  target: WaitStepupTarget | string,
  options: { maxWaitMs?: number; intervalMs?: number } = {},
): Promise<WaitStepupResult> {
  const normalized =
    typeof target === 'string'
      ? { sid: target }
      : {
          sid: target.sid?.trim() || undefined,
          resource: target.resource?.trim() || undefined,
          action: target.action?.trim() || undefined,
        };

  let sid = normalized.sid;
  if (!sid && normalized.resource && normalized.action) {
    const resolved = await pollStepupByCoordinate(config, {
      resource: normalized.resource,
      action: normalized.action,
    });
    if (resolved.status === 'timeout' || !resolved.sid) {
      return {
        envelope: resolved.envelope,
        outcome: 'timeout',
        elapsedMs: 0,
        attempts: 1,
      };
    }
    if (resolved.status === 'verified') {
      return {
        envelope: resolved.envelope,
        outcome: 'verified',
        elapsedMs: 0,
        attempts: 1,
        sid: resolved.sid,
      };
    }
    if (resolved.status === 'rejected') {
      return {
        envelope: resolved.envelope,
        outcome: 'rejected',
        elapsedMs: 0,
        attempts: 1,
        sid: resolved.sid,
      };
    }
    sid = resolved.sid;
  }
  if (!sid) {
    throw new Error('sid or resource+action is required');
  }

  const maxWaitMs = options.maxWaitMs ?? 300_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + maxWaitMs;
  let attempts = 0;
  let lastEnvelope: Envelope | undefined;
  while (true) {
    attempts += 1;
    const result =
      normalized.resource && normalized.action && !normalized.sid
        ? await pollStepupByCoordinate(config, {
            resource: normalized.resource,
            action: normalized.action,
          })
        : await pollStepupSession(config, sid);
    lastEnvelope = result.envelope;
    if (result.status === 'verified') {
      return {
        envelope: result.envelope,
        outcome: 'verified',
        elapsedMs: maxWaitMs - Math.max(0, deadline - Date.now()),
        attempts,
        sid,
      };
    }
    if (result.status === 'rejected') {
      return {
        envelope: result.envelope,
        outcome: 'rejected',
        elapsedMs: maxWaitMs - Math.max(0, deadline - Date.now()),
        attempts,
        sid,
      };
    }
    if (result.status === 'timeout') {
      return {
        envelope: result.envelope,
        outcome: 'timeout',
        elapsedMs: maxWaitMs - Math.max(0, deadline - Date.now()),
        attempts,
        sid,
      };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // Wait window ended with no terminal status — same skip path as expired.
      return {
        envelope: lastEnvelope,
        outcome: 'timeout',
        elapsedMs: maxWaitMs - Math.max(0, remaining),
        attempts,
        sid,
      };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(intervalMs, remaining)),
    );
  }
}
