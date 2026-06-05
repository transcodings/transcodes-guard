/**
 * Minimal HTTP client for the Transcodes step-up endpoints.
 *
 * Re-implements transcodes-mcp-server/src/client.ts using Node 20+ builtin
 * fetch so we avoid adding an axios dependency. Only the two step-up routes
 * are exercised: POST /v1/auth/temp-session/step-up/session and GET …/:sid.
 */
import type { StepupConfig } from './config.js';
export type RequestInput = {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    /** Path after `/v1`, e.g. `/auth/temp-session/step-up/session`. */
    path: string;
    /**
     * Query parameters. `undefined`/`null`/`""` values are dropped — parity with
     * transcodes-mcp-server/src/client.ts so DELETE …?key=… style endpoints
     * behave identically.
     */
    query?: Record<string, string | number | boolean | undefined | null>;
    body?: unknown;
    /**
     * Step-up MFA session id. When set, sent as `X-Step-Up-Session-Id` header
     * so the backend can verify the verified record before executing a
     * sensitive operation. Used by tool handlers that consumed a verified
     * record via `withStepupVerifiedSid`.
     */
    stepUpSid?: string;
    /**
     * Send no request body at all (e.g. `DELETE …/resources/:key` with query
     * params only). Without this flag, body=undefined still sends `{}` so
     * Nest's `@Body()` validation passes — matches transcodes parity.
     */
    omitBody?: boolean;
};
export type Envelope = {
    ok: boolean;
    status: number;
    data: unknown;
};
/**
 * Returns an envelope mirroring transcodes-mcp-server's response shape:
 *   { ok, status: HTTP code, data: backend body }
 * Network failures are reported as { ok:false, status:0, data:{ error, message } }
 * with no internal URL leakage (parity with the upstream client).
 */
export declare function request(config: StepupConfig, input: RequestInput): Promise<Envelope>;
