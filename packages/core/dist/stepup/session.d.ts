/**
 * Step-up MFA session — create / poll.
 *
 * Adapted from transcodes-mcp-server/src/tools/stepup.ts. The framework-
 * specific MCP tool wiring is split out (see src/server.ts); this file
 * holds pure async functions usable from both the hook and the server.
 */
import { type Envelope } from './client.js';
import type { StepupConfig } from './config.js';
export type CreateStepupArgs = {
    /** One short sentence describing what the user is confirming. */
    summary: string;
    action?: string | undefined;
    resource?: string | undefined;
    member_id?: string | undefined;
    /** @deprecated Use `summary`. Kept for callers that still pass `comment`. */
    comment?: string;
};
export type CreateConsoleSessionArgs = {
    comment?: string;
};
export type CreatedStepupSession = {
    envelope: Envelope;
    /** Parsed when the backend envelope shape matches; undefined otherwise. */
    sid?: string | undefined;
    browserUrl?: string | undefined;
    expiresAt?: string | undefined;
    /** Session mode the backend assigned (stepup/console/signin). */
    mode?: string | undefined;
};
export type PollStepupResult = {
    envelope: Envelope;
    /** pending | verified | rejected | timeout (expired / missing / wait ended). */
    status?: string | undefined;
};
/** MCP / hook step-up — POST .../step-up/session (mode fixed server-side). */
export declare function createStepupSession(config: StepupConfig, args: CreateStepupArgs): Promise<CreatedStepupSession>;
/** Console auth-host session — same endpoint as Toolkit `redirectToConsole()`. */
export declare function createConsoleBrowserSession(config: StepupConfig, args?: CreateConsoleSessionArgs): Promise<CreatedStepupSession>;
export declare function pollStepupSession(config: StepupConfig, sid: string): Promise<PollStepupResult>;
/**
 * Resolve live step-up status by member-scoped RBAC coordinate (MAT auth).
 * Prefer this when the agent has resource/action from the deny payload and
 * may not retain sid.
 */
export declare function pollStepupByCoordinate(config: StepupConfig, coordinate: {
    resource: string;
    action: string;
}): Promise<PollStepupResult & {
    sid?: string;
}>;
export type WaitStepupResult = {
    /** Last poll's envelope — useful for diagnostics. */
    envelope: Envelope;
    /** verified = retry command; timeout = skip (decline, TTL, or wait ended). */
    outcome: 'verified' | 'rejected' | 'timeout';
    /** Total elapsed time in ms across all polls. */
    elapsedMs: number;
    /** Number of poll requests issued. */
    attempts: number;
    /** Resolved session id (from sid arg or coordinate lookup). */
    sid?: string;
};
export type WaitStepupTarget = {
    sid?: string;
    resource?: string;
    action?: string;
};
/**
 * Block until step-up is verified or the wait window elapses.
 *
 * Prefer `{ resource, action }` (coordinate poll). Optional `sid` skips the
 * coordinate lookup and hits `GET .../session/:sid` directly.
 */
export declare function pollStepupSessionWait(config: StepupConfig, target: WaitStepupTarget | string, options?: {
    maxWaitMs?: number;
    intervalMs?: number;
}): Promise<WaitStepupResult>;
