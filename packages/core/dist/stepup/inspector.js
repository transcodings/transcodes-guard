/**
 * Read-only inspector for the client's step-up state (Guard v3).
 *
 * There is no client step-up state left to report. The backend owns every
 * status — reuse is keyed by the Redis coordinate
 * `stepup:{projectId}:{memberId}:{resource}:{action}` and browser dedupe is the
 * backend's SET NX claim (toolgate t1) — so the local latch / prompt-group files
 * this inspector used to surface were removed in t3.
 *
 * The tool is kept as the agent-facing answer to "what does the client hold?":
 * `client_state_files: []` is a load-bearing assertion, not an empty stub. To
 * check whether a coordinate is verified, poll the backend
 * (`tc_poll_stepup_session`), never a local file.
 */
import { cacheDir } from '../paths/index.js';
import { STEPUP_TTL_MS } from './config.js';
export function inspectStepupState(now = Date.now()) {
    return {
        cache_dir: cacheDir(),
        now_ms: now,
        ttl_ms: STEPUP_TTL_MS,
        client_state_files: [],
        backend_owns_state: true,
    };
}
//# sourceMappingURL=inspector.js.map