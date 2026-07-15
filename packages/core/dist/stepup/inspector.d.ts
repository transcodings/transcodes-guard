export type StepupStateInspection = {
    cache_dir: string;
    now_ms: number;
    /** Backend step-up session TTL, echoed for the agent's wait budgeting. */
    ttl_ms: number;
    /**
     * Always empty: Guard v3 keeps no step-up state on the client. Present so the
     * agent reads a fact rather than inferring one from a missing field.
     */
    client_state_files: never[];
    /** Where the client would keep cache files, for diagnostics. */
    backend_owns_state: true;
};
export declare function inspectStepupState(now?: number): StepupStateInspection;
