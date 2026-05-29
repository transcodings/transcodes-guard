/**
 * Step-up MFA MCP tools.
 * Flow: create_stepup_session → user completes MFA in the browser and tells us → poll_stepup_session
 * confirms (no automatic polling loop).
 *
 * Backend endpoints (same env base, poll appends `/:sid` as pathSuffix):
 *   POST …/step-up/session                          → create_stepup_session (comment: one sentence shown in the step-up UI)
 *   GET  /v1/auth/temp-session/step-up/session/:sid → poll_stepup_session
 */
import type { ProxyTool } from './tool-utils.ts';
import { parse, req } from './tool-utils.ts';
import type { ProxyConfig } from '../config.ts';

/** Extracts the step-up status string ("pending" | "verified") from the poll response. */
function extractPollStepStatus(parsed: unknown): string | undefined {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const root = parsed as Record<string, unknown>;
  const data = root['data'];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }
  const inner = data as Record<string, unknown>;
  const pl = inner['payload'];
  if (!Array.isArray(pl) || pl.length === 0) return undefined;
  const first = pl[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    return undefined;
  }
  const st = (first as Record<string, unknown>)['status'];
  return typeof st === 'string' ? st : undefined;
}

/** Prefers the `member_id` tool argument; falls back to the `mid` claim from TRANSCODES_TOKEN. */
function resolveMemberIdForStepup(
  a: Record<string, unknown>,
  config: ProxyConfig,
): string {
  return parse.str(a, 'member_id') ?? config.memberId;
}

export const stepupTools: ProxyTool[] = [
  {
    name: 'create_stepup_session',
    description:
      'Create a step-up MFA session before a sensitive operation; returns sid, browser URL, expiry; ' +
      'Required: comment — one short sentence for the step-up screen explaining why MFA is needed; ' +
      'send the URL, ask the user to finish MFA and tell you when done (no polling loop); then poll_stepup_session, TTL 10 minutes',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: {
          type: 'string',
          description:
            'Member public ID to authenticate; ' +
            'if omitted, uses memberId from TRANSCODES_TOKEN (config)',
        },
        action: {
          type: 'string',
          description: 'Action identifier to include in the audit log (e.g. "revoke")',
        },
        resource: {
          type: 'string',
          description: 'Protected resource identifier to include in the audit log (e.g. "billing")',
        },
        comment: {
          type: 'string',
          description:
            'One short sentence shown in the step-up UI (e.g. "Confirm revoking member kim@example.com")',
        },
      },
      required: ['comment'],
    },
    handler: async (a, config) => {
      const member_id = resolveMemberIdForStepup(a, config);

      const comment = parse.str(a, 'comment');
      if (!comment || !comment.trim()) {
        return JSON.stringify(
          {
            ok: false,
            message: 'comment is required: one short sentence for the step-up UI',
          },
          null,
          2,
        );
      }

      return req(
        config,
        {
          method: 'POST',
          body: {
            project_id: config.projectId,
            member_id,
            action: parse.str(a, 'action'),
            resource: parse.str(a, 'resource'),
            comment: comment.trim(),
          },
        },
        'create_stepup_session',
      );
    },
  },

  {
    name: 'poll_stepup_session',
    description:
      'Check the current status of a step-up MFA session (single GET); ' +
      'returns status "pending" or "verified", or 404 if the session has expired (TTL 10 minutes); ' +
      'call after the user says they finished browser MFA — not on a fixed interval',
    inputSchema: {
      type: 'object',
      properties: {
        sid: {
          type: 'string',
          description: 'The session ID (mcpup_...) returned from create_stepup_session',
        },
      },
      required: ['sid'],
    },
    handler: async (a, config) => {
      const sid = parse.str(a, 'sid');
      if (!sid) {
        return JSON.stringify({
          ok: false,
          message: 'sid is required',
        }, null, 2);
      }

      const raw = await req(
        config,
        { method: 'GET' },
        'poll_stepup_session',
        `/${sid}`,
      );

      try {
        const parsed: unknown = JSON.parse(raw);
        // The axios wrapper returns { ok, status: HTTP code, data: backend body }. The step-up
        // status string lives at data.payload[0].status — the top-level `status` is the numeric
        // HTTP code (e.g. 200) so checking it here would never observe "verified".
        const stepStatus = extractPollStepStatus(parsed);
        if (stepStatus === 'verified') {
          config.verifiedStepup = { sid, verifiedAt: Date.now() };
        }
      } catch {
        // Parsing failure is not fatal; we still return the raw response below.
      }

      return raw;
    },
  },
];
