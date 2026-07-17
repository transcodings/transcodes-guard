/**
 * Read-only inspector for the client's step-up state (Guard v3).
 *
 * There is no client step-up state left to report. The backend owns every
 * status — reuse is keyed by the Redis coordinate
 * `stepup:{projectId}:{memberId}:{resource}:{action}` and session dedupe (not tab dedupe, t8) is the
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

export type StepupStateInspection = {
  /** Where the client would keep cache files, for diagnostics. */
  cache_dir: string;
  now_ms: number;
  /** Backend step-up session TTL, echoed for the agent's wait budgeting. */
  ttl_ms: number;
  /**
   * Always empty: Guard v3 keeps no step-up state on the client. Present so the
   * agent reads a fact rather than inferring one from a missing field.
   */
  client_state_files: never[];
  /** The backend owns every step-up status; poll it, never a local file. */
  backend_owns_state: true;
};

export function inspectStepupState(
  now: number = Date.now(),
): StepupStateInspection {
  return {
    cache_dir: cacheDir(),
    now_ms: now,
    ttl_ms: STEPUP_TTL_MS,
    client_state_files: [],
    backend_owns_state: true,
  };
}
