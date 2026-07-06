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
import { cacheDir } from '@transcodes-guard/plugin-paths';
import { STEPUP_TTL_MS } from './config.js';
import { type LatchInspection, listLatches } from './latch.js';
import { peekPromptGroup } from './sid.js';

export type StepupStateInspection = {
  cache_dir: string;
  now_ms: number;
  ttl_ms: number;
  /** Current per-prompt grouping id (null when none minted / expired). */
  prompt_group: string | null;
  /** In-flight browser/poll latches, one per (group, resource, action). */
  latches: LatchInspection[];
};

export type { LatchInspection };

export function inspectStepupState(
  now: number = Date.now(),
): StepupStateInspection {
  return {
    cache_dir: cacheDir(),
    now_ms: now,
    ttl_ms: STEPUP_TTL_MS,
    prompt_group: peekPromptGroup(now),
    latches: listLatches(now),
  };
}
