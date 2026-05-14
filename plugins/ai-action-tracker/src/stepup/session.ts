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
      project_id: config.projectId,
      member_id: args.member_id ?? config.memberId,
      action: args.action,
      resource: args.resource,
      comment,
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
