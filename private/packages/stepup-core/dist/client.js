const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Returns an envelope mirroring transcodes-mcp-server's response shape:
 *   { ok, status: HTTP code, data: backend body }
 * Network failures are reported as { ok:false, status:0, data:{ error, message } }
 * with no internal URL leakage (parity with the upstream client).
 */
export async function request(config, input) {
    const path = input.path.startsWith('/') ? input.path : `/${input.path}`;
    const params = new URLSearchParams();
    if (input.query) {
        for (const [k, v] of Object.entries(input.query)) {
            if (v !== undefined && v !== null && v !== '') {
                params.append(k, String(v));
            }
        }
    }
    const qs = params.toString();
    const url = `${config.apiBaseV1}${path}${qs ? `?${qs}` : ''}`;
    const headers = {
        'x-transcodes-token': config.token,
        Accept: 'application/json',
    };
    if (input.stepUpSid) {
        headers['X-Step-Up-Session-Id'] = input.stepUpSid;
    }
    let body;
    const sendsBody = input.method !== 'GET' && !input.omitBody;
    if (sendsBody) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(input.body ?? {});
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: input.method,
            headers,
            body,
            signal: controller.signal,
        });
        let data;
        const text = await response.text();
        try {
            data = text ? JSON.parse(text) : null;
        }
        catch {
            data = text;
        }
        return {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            data,
        };
    }
    catch (err) {
        const aborted = err instanceof Error &&
            (err.name === 'AbortError' || err.name === 'TimeoutError');
        return {
            ok: false,
            status: 0,
            data: {
                error: 'Network Request Failed',
                message: aborted
                    ? 'Request timed out'
                    : 'Could not reach the backend. Check TRANSCODES_BACKEND_URL and network connectivity.',
            },
        };
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=client.js.map