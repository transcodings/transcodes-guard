import { type StepupConfig } from './config.js';
export declare const CONSOLE_SESSION_COMMENT = "Manage your authentication methods (passkeys, TOTP, security keys)";
export type ConsoleSessionResult = {
    ok: true;
    sid: string;
    browserUrl: string;
    expiresAt?: string;
    launched: boolean;
} | {
    ok: false;
    reason: 'no-token' | 'create-failed' | 'error';
    detail?: string;
};
export type MemberProfileSummary = {
    name?: string;
    email?: string;
    role?: string;
};
/** Fetch name/email/role for the token's member (best-effort). */
export declare function fetchMemberProfile(config: StepupConfig): Promise<MemberProfileSummary | null>;
/**
 * Mint a console-mode step-up session and optionally open the auth host in
 * the system browser. Used by `transcodes console` and the CLI dashboard.
 */
export declare function openConsoleSession(options?: {
    openBrowser?: boolean;
    comment?: string;
}): Promise<ConsoleSessionResult>;
