/**
 * Step-up MFA session — create / poll.
 *
 * Adapted from transcodes-mcp-server/src/tools/stepup.ts. The framework-
 * specific MCP tool wiring is split out (see src/server.ts); this file
 * holds pure async functions usable from both the hook and the server.
 */
import { type Envelope } from "./client.js";
import type { StepupConfig } from "./config.js";
export type CreateStepupArgs = {
    comment: string;
    action?: string;
    resource?: string;
    member_id?: string;
};
export type CreatedStepupSession = {
    envelope: Envelope;
    /** Parsed when the backend envelope shape matches; undefined otherwise. */
    sid?: string;
    browserUrl?: string;
    expiresAt?: string;
};
export type PollStepupResult = {
    envelope: Envelope;
    /** "pending" | "verified" | undefined when the envelope shape did not match. */
    status?: string;
};
export declare function createStepupSession(config: StepupConfig, args: CreateStepupArgs): Promise<CreatedStepupSession>;
export declare function pollStepupSession(config: StepupConfig, sid: string): Promise<PollStepupResult>;
export type WaitStepupResult = {
    /** Last poll's envelope — useful for diagnostics. */
    envelope: Envelope;
    /** "verified" if reached before deadline, otherwise "timeout". */
    outcome: "verified" | "timeout";
    /** Total elapsed time in ms across all polls. */
    elapsedMs: number;
    /** Number of poll requests issued. */
    attempts: number;
};
/**
 * Block until step-up is verified or the wait window elapses.
 *
 * Replaces the agent-driven 60-call polling loop with a single, deterministic
 * tool call: caller invokes once, awaits resolution. Polling cadence and
 * timeout live in this server-side function so the agent has no chance to
 * silently shorten or skip the loop.
 */
export declare function pollStepupSessionWait(config: StepupConfig, sid: string, options?: {
    maxWaitMs?: number;
    intervalMs?: number;
}): Promise<WaitStepupResult>;
