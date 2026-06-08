export type VerifiedInspection = {
    exists: false;
} | {
    exists: true;
    sid: string;
    verified_at_ms: number;
    age_ms: number;
    expired: boolean;
    ttl_ms: number;
    /** Present for FP-KEYED records (Bash + user tool-rules); absent for
     * the GLOBAL MCP system-rule record. */
    fp?: string;
};
export type PendingInspection = {
    exists: false;
} | {
    exists: true;
    sid: string;
    status: 'pending' | 'verified';
    command_preview: string;
    browser_url: string;
    created_at_ms: number;
    age_ms: number;
    expired: boolean;
    expires_at?: string;
    fp?: string;
};
export type BrowserLockInspection = {
    exists: false;
} | {
    exists: true;
    fingerprint: string;
    opened_at_ms: number;
    age_ms: number;
    expired: boolean;
    ttl_ms: number;
};
export type StepupStateInspection = {
    cache_dir: string;
    now_ms: number;
    /** GLOBAL records (MCP system-rule path). */
    verified: VerifiedInspection;
    pending: PendingInspection;
    /** FP-KEYED records (Bash + user tool-rules, content-addressed). Each
     * danger command in flight has its own entry — this is where the agent
     * looks to confirm its own command (matched by command_preview) is
     * verified, without picking up another sub-agent's record. */
    verified_fp: VerifiedInspection[];
    pending_fp: PendingInspection[];
    browser_lock: BrowserLockInspection;
};
export declare function inspectStepupState(now?: number): StepupStateInspection;
