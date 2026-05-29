/**
 * Member MCP access token (JWT) parser.
 *
 * Policy:
 *   - Fatal (throw): payload cannot be decoded, missing oid/pid/mid,
 *                    missing/invalid/expired exp.
 *   - Warning: missing aud or aud not including transcodes-mcp,
 *              token shape that does not look like a JWT.
 *   - Signature verification is performed by the backend (x-transcodes-token).
 */

/** Audience this token is expected to carry (mismatch becomes a warning). */
export const REQUIRED_AUDIENCE = 'transcodes-mcp';

export type MemberTokenClaims = {
  organizationId: string;
  projectId: string;
  memberId: string;
  /** Normalised audience list. Undefined if absent. */
  aud?: readonly string[];
  /** NumericDate (epoch seconds). Always present once parsing succeeds. */
  exp: number;
  iss?: string;
  jti?: string;
  iat?: number;
};

export type ParsedMemberToken = {
  /** Trimmed raw JWT — pass straight to the x-transcodes-token header. */
  raw: string;
  claims: MemberTokenClaims;
  /** Non-fatal validation warnings (caller should log to stderr or similar). */
  warnings: readonly string[];
};

// ─── Internal helpers ──────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Returns undefined on failure. Node 16+ 'base64url' handles URL-safe + padding. */
function tryDecodeBase64UrlJson(
  segment: string
): Record<string, unknown> | undefined {
  if (!segment) return undefined;
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Returns rec[key] trimmed when it is a non-empty string, undefined otherwise. */
function readString(
  rec: Record<string, unknown>,
  key: string
): string | undefined {
  const v = rec[key];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

/** JWT NumericDate. Accepts numbers and numeric strings; returns integer seconds or undefined. */
function readNumericDate(
  rec: Record<string, unknown>,
  key: string
): number | undefined {
  const v = rec[key];
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim()
      ? Number(v)
      : Number.NaN;
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

/** Normalises aud into a string[]. Returns undefined when empty or malformed. */
function readAudience(
  rec: Record<string, unknown>
): readonly string[] | undefined {
  const aud = rec['aud'];
  if (typeof aud === 'string') {
    const t = aud.trim();
    return t ? [t] : undefined;
  }
  if (Array.isArray(aud)) {
    const list = aud
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}

// ─── public ────────────────────────────────────────────────────────────────

export function parseMemberAccessToken(rawToken: unknown): ParsedMemberToken {
  if (typeof rawToken !== 'string') {
    throw new Error('token must be a string');
  }
  const raw = rawToken.trim();
  if (!raw) {
    throw new Error('token is empty');
  }

  const warnings: string[] = [];

  const parts = raw.split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) {
    warnings.push(
      `token does not look like a JWT (expected 3 non-empty segments, got ${parts.length})`
    );
  }

  // Pick the payload segment: parts[1] when it looks like a JWT, otherwise try the whole string.
  const payloadSegment = parts.length === 3 ? parts[1] : raw;
  const payload = tryDecodeBase64UrlJson(payloadSegment);
  if (!payload) {
    throw new Error(
      'token payload could not be decoded as base64url JSON object'
    );
  }

  // Backend-issued tokens use the short claim names only: oid / pid / mid.
  const organizationId = readString(payload, 'oid');
  const projectId = readString(payload, 'pid');
  const memberId = readString(payload, 'mid');
  if (!organizationId || !projectId || !memberId) {
    throw new Error('token payload must include oid, pid, and mid claims');
  }

  const aud = readAudience(payload);
  if (!aud) {
    warnings.push('aud claim is missing');
  } else if (!aud.includes(REQUIRED_AUDIENCE)) {
    warnings.push(
      `aud does not include "${REQUIRED_AUDIENCE}" (got ${JSON.stringify(aud)})`
    );
  }

  const exp = readNumericDate(payload, 'exp');
  if (exp === undefined) {
    throw new Error(
      'token must include exp claim (NumericDate, integer seconds)'
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec >= exp) {
    throw new Error('token has expired');
  }

  return {
    raw,
    claims: {
      organizationId,
      projectId,
      memberId,
      aud,
      exp,
      iss: readString(payload, 'iss'),
      jti: readString(payload, 'jti'),
      iat: readNumericDate(payload, 'iat'),
    },
    warnings,
  };
}
