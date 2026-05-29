/**
 * Transcodes backend HTTP client.
 * Sends TRANSCODES_TOKEN (JWT) on every request as the `x-transcodes-token` header.
 * Returns all responses (including 4xx/5xx) as a JSON string so the AI can inspect them.
 */
import axios, { type Method } from 'axios';
import type { ProxyConfig } from './config.ts';

/** Abort requests that take longer than this (milliseconds) */
const REQUEST_TIMEOUT_MS = 30_000;

export type RequestInput = {
  method: Method;
  /** Path after `/v1`, e.g. `/auth/roles` */
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /**
   * When set, sent as `X-Step-Up-Session-Id` header so the backend can
   * verify the step-up MFA session before executing the sensitive operation.
   */
  stepUpSid?: string;
  /**
   * When true, do not send a request body at all (e.g. DELETE …/resources/:key with query only).
   * When false/unset, an empty body becomes `{}` with Content-Type application/json so Nest's
   * `@Body()` validation still accepts the request.
   */
  omitBody?: boolean;
};

function jsonBodyForMethod(
  method: Method,
  body: unknown | undefined,
  omitBody: boolean | undefined
): unknown | undefined {
  const m = String(method).toUpperCase();
  if (m === 'GET' || m === 'HEAD') return undefined;
  if (omitBody) return undefined;
  if (body === undefined || body === null) return {};
  return body;
}

export async function request(
  config: ProxyConfig,
  input: RequestInput
): Promise<string> {
  const path = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const url = `${config.apiBaseV1}${path}`;

  const params: Record<string, unknown> = {};
  if (input.query) {
    for (const [k, v] of Object.entries(input.query)) {
      if (v !== undefined && v !== null && v !== '') {
        params[k] = v;
      }
    }
  }

  const data = jsonBodyForMethod(input.method, input.body, input.omitBody);

  try {
    const response = await axios({
      method: input.method,
      url,
      params,
      data,
      headers: {
        'x-transcodes-token': config.token,
        Accept: 'application/json',
        ...(input.stepUpSid ? { 'X-Step-Up-Session-Id': input.stepUpSid } : {}),
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      validateStatus: () => true,
      timeout: REQUEST_TIMEOUT_MS,
    });

    return JSON.stringify(
      {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        data: response.data,
      },
      null,
      2
    );
  } catch (error) {
    // Intentionally omit the raw error message to avoid leaking internal host/URL info.
    const isTimeout =
      axios.isAxiosError(error) && error.code === 'ECONNABORTED';
    const networkMessage = isTimeout
      ? 'Request timed out'
      : 'Could not reach the backend. Check TRANSCODES_BACKEND_URL and network connectivity.';
    return JSON.stringify(
      {
        ok: false,
        status: 0,
        data: { error: 'Network Request Failed', message: networkMessage },
      },
      null,
      2
    );
  }
}
