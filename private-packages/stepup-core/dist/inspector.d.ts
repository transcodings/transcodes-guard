export type VerifiedInspection = {
    exists: false;
} | {
    exists: true;
    sid: string;
    verified_at_ms: number;
    age_ms: number;
    expired: boolean;
    ttl_ms: number;
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
    verified: VerifiedInspection;
    pending: PendingInspection;
    browser_lock: BrowserLockInspection;
};
export declare function inspectStepupState(now?: number): StepupStateInspection;
