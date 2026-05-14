/**
 * Minimal HTTP client for the Transcodes step-up endpoints.
 *
 * Re-implements transcodes-mcp-server/src/client.ts using Node 20+ builtin
 * fetch so we avoid adding an axios dependency. Only the two step-up routes
 * are exercised: POST /v1/auth/temp-session/step-up/session and GET …/:sid.
 */
import type { StepupConfig } from "./config.js";
export type RequestInput = {
    method: "GET" | "POST";
    /** Path after `/v1`, e.g. `/auth/temp-session/step-up/session`. */
    path: string;
    body?: unknown;
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
