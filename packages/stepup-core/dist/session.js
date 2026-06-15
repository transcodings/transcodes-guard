/**
 * Step-up MFA session — create / poll.
 *
 * Adapted from transcodes-mcp-server/src/tools/stepup.ts. The framework-
 * specific MCP tool wiring is split out (see src/server.ts); this file
 * holds pure async functions usable from both the hook and the server.
 */
import { request } from './client.js';
const STEPUP_PATH = '/auth/temp-session/step-up/session';
/**
 * Look for a step-up payload object at `envelope.data.payload[0]`.
 * Mirrors the response shape transcodes-mcp-server already relies on.
 */
function readStepupPayload(envelope) {
    const data = envelope.data;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return undefined;
    }
    const payload = data.payload;
    if (!Array.isArray(payload) || payload.length === 0)
        return undefined;
    const first = payload[0];
    if (first === null || typeof first !== 'object' || Array.isArray(first)) {
        return undefined;
    }
    return first;
}
function readString(rec, key) {
    const v = rec[key];
    return typeof v === 'string' && v.trim() ? v : undefined;
}
export async function createStepupSession(config, args) {
    const comment = args.comment?.trim();
    if (!comment) {
        throw new Error('comment is required: one short sentence for the step-up UI');
    }
    const envelope = await request(config, {
        method: 'POST',
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
        sid: payload ? readString(payload, 'sid') : undefined,
        browserUrl: payload
            ? readString(payload, 'url') ??
                readString(payload, 'browser_url') ??
                readString(payload, 'browserUrl')
            : undefined,
        expiresAt: payload
            ? readString(payload, 'expiresAt') ?? readString(payload, 'expires_at')
            : undefined,
    };
}
export async function pollStepupSession(config, sid) {
    const trimmed = sid?.trim();
    if (!trimmed) {
        throw new Error('sid is required');
    }
    const envelope = await request(config, {
        method: 'GET',
        path: `${STEPUP_PATH}/${encodeURIComponent(trimmed)}`,
    });
    const payload = readStepupPayload(envelope);
    return {
        envelope,
        status: payload ? readString(payload, 'status') : undefined,
    };
}
/**
 * Block until step-up is verified or the wait window elapses.
 *
 * Replaces the agent-driven 60-call polling loop with a single, deterministic
 * tool call: caller invokes once, awaits resolution. Polling cadence and
 * timeout live in this server-side function so the agent has no chance to
 * silently shorten or skip the loop.
 */
export async function pollStepupSessionWait(config, sid, options = {}) {
    const trimmed = sid?.trim();
    if (!trimmed) {
        throw new Error('sid is required');
    }
    const maxWaitMs = options.maxWaitMs ?? 60_000;
    const intervalMs = options.intervalMs ?? 1_000;
    const deadline = Date.now() + maxWaitMs;
    let attempts = 0;
    let lastEnvelope;
    while (true) {
        attempts += 1;
        const result = await pollStepupSession(config, trimmed);
        lastEnvelope = result.envelope;
        if (result.status === 'verified') {
            return {
                envelope: result.envelope,
                outcome: 'verified',
                elapsedMs: maxWaitMs - Math.max(0, deadline - Date.now()),
                attempts,
            };
        }
        if (result.status === 'rejected') {
            return {
                envelope: result.envelope,
                outcome: 'rejected',
                elapsedMs: maxWaitMs - Math.max(0, deadline - Date.now()),
                attempts,
            };
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            return {
                envelope: lastEnvelope,
                outcome: 'timeout',
                elapsedMs: maxWaitMs - Math.max(0, remaining),
                attempts,
            };
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }
}
//# sourceMappingURL=session.js.map