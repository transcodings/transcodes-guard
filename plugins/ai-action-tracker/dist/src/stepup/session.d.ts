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
