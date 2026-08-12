/**
 * CSRF admission rules for the dashboard daemon.
 *
 * Kept in its own module with no imports: `dashboard.ts` reaches the backend,
 * the sync engine and `version.ts` (which resolves `package.json` against the
 * bundled layout), so it cannot be imported from a test. These rules are the
 * part worth testing, so they live where a test can reach them.
 */
import type { IncomingMessage } from 'node:http';

/** Methods that cannot change state — exempt from the CSRF origin check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Hostnames that resolve to this machine's loopback interface. */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') {
    return true;
  }
  // 127.0.0.0/8 — the whole block reaches the loopback listener.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * CSRF gate. The Host guard stops DNS rebinding; this stops a page the user
 * merely visited from POSTing here. Browsers set Sec-Fetch-Site and Origin
 * themselves and page JS cannot override them, so both are trustworthy.
 *
 * Port is deliberately ignored, matching the Host guard: it accepts both
 * `localhost` and `127.0.0.1`, so a user who typed `localhost` in the address
 * bar must keep working. A browser cannot lie about its own origin's host.
 *
 * Requests with neither header are not browsers (curl, Node). They are allowed
 * — an attacker who can run local code is outside this threat model.
 */
export function isAllowedRequestOrigin(input: {
  method: string;
  secFetchSite?: string;
  origin?: string;
}): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;

  // Modern browsers: trust the strictest signal. `same-site` is NOT enough —
  // every http://localhost:* origin is same-site with us.
  const site = input.secFetchSite?.trim().toLowerCase();
  if (site) return site === 'same-origin';

  // Safari <= 16.3 and other pre-Sec-Fetch browsers still send Origin on POST.
  // Any Origin at all means a browser sent this, so an unusable one (opaque
  // `null` from a sandboxed iframe, or unparseable) is a denial rather than a
  // fall-through to the non-browser branch below.
  const origin = input.origin?.trim();
  if (origin) {
    if (origin === 'null') return false;
    try {
      return isLoopbackHostname(new URL(origin).hostname);
    } catch {
      return false;
    }
  }

  return true; // non-browser client
}

/**
 * Second layer, independent of the origin check: requiring application/json
 * makes any cross-origin attempt preflighted, and the preflight fails.
 *
 * This does NOT cover /api/console/open, /api/login and /api/logout — they take
 * no body, so `readJsonBody` never runs for them. The entry-point origin guard
 * is what protects those.
 */
export function hasJsonContentType(req: IncomingMessage): boolean {
  const mediaType = (req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return mediaType === 'application/json';
}

/**
 * A request the client got wrong, carrying the status to answer with.
 *
 * Route handlers sit under two different catches — the persona group answers
 * 400, the outer handler 500 — so a bare Error would report the same rejection
 * as a server fault on one path and a client fault on the other.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Status to answer with: an HttpError's own, otherwise a server fault. */
export function statusForError(err: unknown, fallback: number): number {
  return err instanceof HttpError ? err.status : fallback;
}
