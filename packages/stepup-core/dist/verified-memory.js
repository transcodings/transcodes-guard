/**
 * In-memory verified step-up sids for the MCP server's handler backstop.
 *
 * Guard v3 removed all on-disk verified/pending records. The PreToolUse hook
 * path no longer needs them: a verified challenge is granted by the backend
 * step-up session on the next `POST /guard/evaluate` (permission → allow). But the
 * built-in transcodes-guard MCP tools (member/rbac/passcode ops) are gated by
 * `execProtectedTool`, a handler backstop that runs INSIDE the long-lived MCP
 * server process — the same process that runs `create_stepup_session` and the
 * `poll_stepup_session*` tools.
 *
 * So the backstop's "was this step-up verified?" flag lives here, in process
 * memory, not on disk:
 *   - `poll_stepup_session*` calls `markStepupVerified(sid)` when the backend
 *     reports `verified`.
 *   - `execProtectedTool` calls `claimStepupVerified()` to consume it (single
 *     shot) before running a protected tool.
 *
 * Process-scoped and single-use by design: a server restart clears it (the user
 * simply re-authenticates), and each verified sid grants exactly one protected
 * call. The backend remains the SSOT — this only caches a sid the backend
 * already verified. TTL (`STEPUP_TTL_MS`) bounds staleness.
 */
import { STEPUP_TTL_MS } from './config.js';
const verified = new Map();
/** Record a backend-verified sid for later single-shot consumption. */
export function markStepupVerified(sid, now = Date.now()) {
    if (sid)
        verified.set(sid, now);
}
/** True when any non-expired verified sid is available (peek, no consume). */
export function hasStepupVerified(now = Date.now()) {
    return claimInternal(now, false) !== null;
}
/**
 * Consume the most-recent non-expired verified sid, removing it. Returns null
 * when none is available. Expired entries are swept on access.
 */
export function claimStepupVerified(now = Date.now()) {
    return claimInternal(now, true);
}
function claimInternal(now, consume) {
    let latestSid = null;
    let latestAt = -1;
    for (const [sid, at] of verified) {
        if (now - at > STEPUP_TTL_MS) {
            verified.delete(sid);
            continue;
        }
        if (at > latestAt) {
            latestAt = at;
            latestSid = sid;
        }
    }
    if (latestSid && consume)
        verified.delete(latestSid);
    return latestSid;
}
//# sourceMappingURL=verified-memory.js.map