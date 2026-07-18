/**
 * RBAC permission-matrix lookup for the PreToolUse gate.
 *
 * After a pattern/tool-rule matches and yields a (resource, action) coordinate,
 * the gate asks the backend what the project's RBAC matrix says for the token's
 * member: 0 = deny, 1 = allow (no step-up), 2 = allow + step-up. This makes the
 * RBAC matrix the single authority for the decision; the local rule only maps a
 * command/tool onto a coordinate.
 *
 * `evaluateAction` returns a `GuardEvaluateFailure` carrying the HTTP status +
 * backend error text on failure, so the hook can surface WHY the gate failed
 * (issue #189). Callers MUST fail-closed — treat any failure as step-up
 * required (2), never as allow.
 */
import { GUARD_PROVIDERS } from '../patterns/index.js';
import { request } from './client.js';
/**
 * The extracted text flows into the agent-facing deny message, and a hostile
 * or misbehaving intermediary (captive portal, corporate proxy) controls the
 * non-2xx body — so bound it: strip control characters and cap the length.
 */
const FAILURE_MESSAGE_MAX_LENGTH = 240;
function sanitizeFailureText(text) {
    let flat = '';
    for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0;
        flat += code < 32 || code === 127 ? ' ' : ch;
    }
    flat = flat.replace(/ {2,}/g, ' ').trim();
    return flat.length > FAILURE_MESSAGE_MAX_LENGTH
        ? `${flat.slice(0, FAILURE_MESSAGE_MAX_LENGTH)}…`
        : flat;
}
/**
 * Pull human-readable failure text out of the backend error envelope.
 * Handles the exception-filter shape (`error` + `logId`), NestJS validation
 * arrays (`message: string[]`), and sanitizes/caps the result. Also consumed
 * by gate-backend's 403 → `STEP_UP_REQUIRED` translation (`wrapProtectedTool`).
 */
export function extractFailureMessage(data) {
    if (!data || typeof data !== 'object')
        return undefined;
    const o = data;
    const text = typeof o.message === 'string' && o.message.trim()
        ? o.message.trim()
        : Array.isArray(o.message) &&
            o.message.length > 0 &&
            o.message.every((m) => typeof m === 'string')
            ? o.message.join('; ')
            : typeof o.error === 'string' && o.error.trim()
                ? o.error.trim()
                : undefined;
    const logId = typeof o.logId === 'string' && o.logId ? o.logId : undefined;
    const combined = text && logId
        ? `${text}; logId=${logId}`
        : (text ?? (logId ? `logId=${logId}` : undefined));
    return combined ? sanitizeFailureText(combined) : undefined;
}
/**
 * POST /v1/guard/evaluate — one round-trip: backend classifies the raw hook
 * payload, applies the matrix, and (for level 2) creates or reuses the
 * member-scoped coordinate step-up session. Every tool call (except built-in
 * transcodes-guard MCP) reaches this path. On any failure returns a
 * `GuardEvaluateFailure` (never a verdict) → caller fails closed and surfaces
 * the failure detail in the deny message.
 */
export async function evaluateAction(config, body) {
    const env = await request(config, {
        method: 'POST',
        path: '/guard/evaluate',
        body: {
            payload: body.payload,
            tool_name: body.toolName,
            cwd: body.cwd,
            provider: body.provider,
        },
    });
    if (!env.ok) {
        return {
            ok: false,
            kind: env.status === 0 ? 'network' : 'http',
            status: env.status,
            message: extractFailureMessage(env.data),
        };
    }
    const malformed = {
        ok: false,
        kind: 'malformed',
        status: env.status,
    };
    const data = env.data;
    const p = (Array.isArray(data?.payload) ? data.payload[0] : null);
    if (!p || typeof p !== 'object')
        return malformed;
    const { permission, resource, action } = p;
    if (permission !== 0 && permission !== 1 && permission !== 2)
        return malformed;
    if (typeof resource !== 'string' || typeof action !== 'string')
        return malformed;
    const status = p.status === 'pending' || p.status === 'verified' || p.status === 'rejected'
        ? p.status
        : null;
    const summary = typeof p.summary === 'string' && p.summary.trim() ? p.summary.trim() : '';
    const provider = typeof p.provider === 'string' &&
        GUARD_PROVIDERS.includes(p.provider)
        ? p.provider
        : null;
    return {
        ok: true,
        verdict: {
            permission,
            resource,
            action,
            reasoning: typeof p.reasoning === 'string' ? p.reasoning : '',
            summary,
            provider,
            sid: typeof p.sid === 'string' ? p.sid : null,
            url: typeof p.url === 'string' ? p.url : null,
            expires_at: typeof p.expires_at === 'string' ? p.expires_at : null,
            exist: p.exist === true,
            status,
        },
    };
}
//# sourceMappingURL=rbac-check.js.map