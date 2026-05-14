/**
 * Minimal HTTP client for the Transcodes step-up endpoints.
 *
 * Re-implements transcodes-mcp-server/src/client.ts using Node 20+ builtin
 * fetch so we avoid adding an axios dependency. Only the two step-up routes
 * are exercised: POST /v1/auth/temp-session/step-up/session and GET …/:sid.
 */
import type { StepupConfig } from "./config.js";

const REQUEST_TIMEOUT_MS = 30_000;

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
export async function request(
  config: StepupConfig,
  input: RequestInput,
): Promise<Envelope> {
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const url = `${config.apiBaseV1}${path}`;

  const headers: Record<string, string> = {
    "x-transcodes-token": config.token,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (input.method !== "GET") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(input.body ?? {});
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: input.method,
      headers,
      body,
      signal: controller.signal,
    });
    let data: unknown;
    const text = await response.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data,
    };
  } catch (err) {
    const aborted =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      ok: false,
      status: 0,
      data: {
        error: "Network Request Failed",
        message: aborted
          ? "Request timed out"
          : "Could not reach the backend. Check TRANSCODES_BACKEND_URL and network connectivity.",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
