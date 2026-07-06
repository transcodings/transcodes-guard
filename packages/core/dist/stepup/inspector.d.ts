import { type LatchInspection } from './latch.js';
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
export declare function inspectStepupState(now?: number): StepupStateInspection;
