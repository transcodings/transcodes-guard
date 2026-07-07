/**
 * Read-only inspector for the client's step-up state (Guard v3).
 *
 * Guard v3 keeps all step-up *status* in the backend cache (SSOT); the client
 * holds only the per-prompt grouping id and the per-coordinate browser latches
 * (`latch.ts`). This inspector surfaces exactly those, as structured JSON with
 * deterministic expiry, so the agent never parses `ls` or guesses from raw
 * timestamps.
 *
 * Strict read-only: never mints a group, never writes or clears a latch. Expired
 * entries are reported intact (with `expired: true`) rather than swept.
 */
import { cacheDir } from '../paths/index.js';
import { STEPUP_TTL_MS } from './config.js';
import { listLatches } from './latch.js';
import { peekPromptGroup } from './sid.js';
export function inspectStepupState(now = Date.now()) {
    return {
        cache_dir: cacheDir(),
        now_ms: now,
        ttl_ms: STEPUP_TTL_MS,
        prompt_group: peekPromptGroup(now),
        latches: listLatches(now),
    };
}
//# sourceMappingURL=inspector.js.map