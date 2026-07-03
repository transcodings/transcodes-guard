import { type LatchInspection } from './latch.js';
export type StepupStateInspection = {
    cache_dir: string;
    now_ms: number;
    ttl_ms: number;
    /** Current per-prompt grouping sid (null when none minted / expired). */
    prompt_sid: string | null;
    /** In-flight browser/poll latches, one per (sid, resource, action). */
    latches: LatchInspection[];
};
export type { LatchInspection };
export declare function inspectStepupState(now?: number): StepupStateInspection;
