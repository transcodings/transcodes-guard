/**
 * Step-up MFA session — create / poll.
 *
 * Adapted from transcodes-mcp-server/src/tools/stepup.ts. The framework-
 * specific MCP tool wiring is split out (see src/server.ts); this file
 * holds pure async functions usable from both the hook and the server.
 */
import { request, type Envelope } from "./client.js";
import type { StepupConfig } from "./config.js";

const STEPUP_PATH = "/auth/temp-session/step-up/session";

export type CreateStepupArgs = {
  comment: string;
  action?: string;
  resource?: string;
  member_id?: string;
  /**
   * Step-up mode. Set to `"console"` to mint a session that gates browser
   * access to the Transcodes console (console-protection flow). Omit for the
   * default command/tool verification flow. Sent verbatim to the backend;
   * `undefined` is dropped from the JSON body.
   */
  mode?: string;
};

export type CreatedStepupSession = {
  envelope: Envelope;
  /** Parsed when the backend envelope shape matches; undefined otherwise. */
  sid?: string;
  browserUrl?: string;
  expiresAt?: string;
};

export type PollStepupResult = {
  envelope: Envelope;
  /** "pending" | "verified" | undefined when the envelope shape did not match. */
  status?: string;
};

/**
 * Look for a step-up payload object at `envelope.data.payload[0]`.
 * Mirrors the response shape transcodes-mcp-server already relies on.
 */
function readStepupPayload(envelope: Envelope): Record<string, unknown> | undefined {
  const data = envelope.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const payload = (data as Record<string, unknown>).payload;
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  const first = payload[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    return undefined;
  }
  return first as Record<string, unknown>;
}

function readString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

export async function createStepupSession(
  config: StepupConfig,
  args: CreateStepupArgs,
): Promise<CreatedStepupSession> {
  const comment = args.comment?.trim();
  if (!comment) {
    throw new Error(
      "comment is required: one short sentence for the step-up UI",
    );
  }

  const envelope = await request(config, {
    method: "POST",
    path: STEPUP_PATH,
    body: {
      organization_id: config.organizationId,
      project_id: config.projectId,
      member_id: args.member_id ?? config.memberId,
      action: args.action,
      resource: args.resource,
      comment,
      mode: args.mode,
    },
  });

  const payload = readStepupPayload(envelope);
  return {
    envelope,
    sid: payload ? readString(payload, "sid") : undefined,
    browserUrl: payload
      ? readString(payload, "url") ??
        readString(payload, "browser_url") ??
        readString(payload, "browserUrl")
      : undefined,
    expiresAt: payload
      ? readString(payload, "expiresAt") ?? readString(payload, "expires_at")
      : undefined,
  };
}

export async function pollStepupSession(
  config: StepupConfig,
  sid: string,
): Promise<PollStepupResult> {
  const trimmed = sid?.trim();
  if (!trimmed) {
    throw new Error("sid is required");
  }
  const envelope = await request(config, {
    method: "GET",
    path: `${STEPUP_PATH}/${encodeURIComponent(trimmed)}`,
  });
  const payload = readStepupPayload(envelope);
  return {
    envelope,
    status: payload ? readString(payload, "status") : undefined,
  };
}

export type WaitStepupResult = {
  /** Last poll's envelope — useful for diagnostics. */
  envelope: Envelope;
  /** "verified" if reached before deadline, otherwise "timeout". */
  outcome: "verified" | "timeout";
  /** Total elapsed time in ms across all polls. */
  elapsedMs: number;
  /** Number of poll requests issued. */
  attempts: number;
};

/**
 * Block until step-up is verified or the wait window elapses.
 *
 * Replaces the agent-driven 60-call polling loop with a single, deterministic
 * tool call: caller invokes once, awaits resolution. Polling cadence and
 * timeout live in this server-side function so the agent has no chance to
 * silently shorten or skip the loop.
 */
export async function pollStepupSessionWait(
  config: StepupConfig,
  sid: string,
  options: { maxWaitMs?: number; intervalMs?: number } = {},
): Promise<WaitStepupResult> {
  const trimmed = sid?.trim();
  if (!trimmed) {
    throw new Error("sid is required");
  }
  const maxWaitMs = options.maxWaitMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + maxWaitMs;
  let attempts = 0;
  let lastEnvelope: Envelope | undefined;
  while (true) {
    attempts += 1;
    const result = await pollStepupSession(config, trimmed);
    lastEnvelope = result.envelope;
    if (result.status === "verified") {
      return {
        envelope: result.envelope,
        outcome: "verified",
        elapsedMs: maxWaitMs - Math.max(0, deadline - Date.now()),
        attempts,
      };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        envelope: lastEnvelope,
        outcome: "timeout",
        elapsedMs: maxWaitMs - Math.max(0, remaining),
        attempts,
      };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(intervalMs, remaining)),
    );
  }
}
