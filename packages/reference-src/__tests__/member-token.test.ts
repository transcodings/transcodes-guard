import { describe, it, expect } from 'vitest';
import { parseMemberAccessToken, REQUIRED_AUDIENCE } from '../token.ts';

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;
const PAST_EXP = Math.floor(Date.now() / 1000) - 3600;

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'none', typ: 'JWT' },
): string {
  return `${encodeSegment(header)}.${encodeSegment(payload)}.sig`;
}

const validPayload = {
  oid: 'org_1',
  pid: 'proj_1',
  mid: 'mem_1',
  aud: REQUIRED_AUDIENCE,
  exp: FUTURE_EXP,
};

describe('parseMemberAccessToken — happy paths', () => {
  it('parses oid / pid / mid into organizationId / projectId / memberId', () => {
    const jwt = makeJwt(validPayload);
    const r = parseMemberAccessToken(jwt);
    expect(r.raw).toBe(jwt);
    expect(r.claims.organizationId).toBe('org_1');
    expect(r.claims.projectId).toBe('proj_1');
    expect(r.claims.memberId).toBe('mem_1');
    expect(r.claims.aud).toEqual([REQUIRED_AUDIENCE]);
    expect(r.claims.exp).toBe(FUTURE_EXP);
    expect(r.warnings).toEqual([]);
  });

  it('ignores long-form / snake_case id claims', () => {
    const jwt = makeJwt({
      organizationId: 'long_org',
      projectId: 'long_proj',
      memberId: 'long_mem',
      organization_id: 'snake_org',
      project_id: 'snake_proj',
      member_id: 'snake_mem',
      aud: REQUIRED_AUDIENCE,
      exp: FUTURE_EXP,
    });
    expect(() => parseMemberAccessToken(jwt)).toThrow('oid, pid, and mid');
  });

  it('accepts aud as an array containing transcodes-mcp', () => {
    const jwt = makeJwt({
      ...validPayload,
      aud: ['other', REQUIRED_AUDIENCE, ' '],
    });
    const r = parseMemberAccessToken(jwt);
    expect(r.claims.aud).toEqual(['other', REQUIRED_AUDIENCE]);
    expect(r.warnings).toEqual([]);
  });

  it('trims surrounding whitespace from the token', () => {
    const jwt = makeJwt(validPayload);
    const r = parseMemberAccessToken(`  ${jwt}\n`);
    expect(r.raw).toBe(jwt);
  });

  it('exposes optional iss / jti / iat when present', () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    const jwt = makeJwt({
      ...validPayload,
      iss: 'https://api.transcodes.com',
      jti: 'jti_1',
      iat: past,
    });
    const r = parseMemberAccessToken(jwt);
    expect(r.claims.iss).toBe('https://api.transcodes.com');
    expect(r.claims.jti).toBe('jti_1');
    expect(r.claims.iat).toBe(past);
    expect(r.warnings).toEqual([]);
  });

  it('coerces numeric-string exp to integer seconds', () => {
    const jwt = makeJwt({ ...validPayload, exp: String(FUTURE_EXP) });
    const r = parseMemberAccessToken(jwt);
    expect(r.claims.exp).toBe(FUTURE_EXP);
    expect(r.warnings).toEqual([]);
  });
});

describe('parseMemberAccessToken — warnings (non-fatal)', () => {
  it('warns when aud is missing', () => {
    const { aud, ...withoutAud } = validPayload;
    const r = parseMemberAccessToken(makeJwt(withoutAud));
    expect(r.claims.organizationId).toBe('org_1');
    expect(r.warnings.some((w) => w.includes('aud claim is missing'))).toBe(true);
  });

  it('warns when aud does not include transcodes-mcp', () => {
    const r = parseMemberAccessToken(makeJwt({ ...validPayload, aud: 'other' }));
    expect(r.claims.organizationId).toBe('org_1');
    expect(r.warnings.some((w) => w.includes('aud does not include'))).toBe(true);
  });

  it('warns when header is broken but payload is fine', () => {
    const jwt = `not-base64-json.${encodeSegment(validPayload)}.sig`;
    const r = parseMemberAccessToken(jwt);
    expect(r.claims.organizationId).toBe('org_1');
    // We do not emit a dedicated warning for a broken header, but parsing must not throw.
    expect(r.warnings).not.toContain(expect.stringMatching(/header/i));
  });
});

describe('parseMemberAccessToken — fatal errors', () => {
  it('rejects non-string input', () => {
    expect(() => parseMemberAccessToken(undefined)).toThrow('must be a string');
    expect(() => parseMemberAccessToken(123)).toThrow('must be a string');
  });

  it('rejects empty / whitespace tokens', () => {
    expect(() => parseMemberAccessToken('   ')).toThrow('empty');
  });

  it('rejects payload that cannot be decoded', () => {
    expect(() => parseMemberAccessToken('a.@@@.c')).toThrow(
      'payload could not be decoded',
    );
  });

  it('rejects payload that is not a JSON object', () => {
    const arrPayload = encodeSegment([1, 2, 3]);
    const jwt = `${encodeSegment({ alg: 'none' })}.${arrPayload}.sig`;
    expect(() => parseMemberAccessToken(jwt)).toThrow('could not be decoded');
  });

  it('rejects payload missing required ids', () => {
    const jwt = makeJwt({ aud: REQUIRED_AUDIENCE, exp: FUTURE_EXP });
    expect(() => parseMemberAccessToken(jwt)).toThrow('oid, pid, and mid');
  });

  it('rejects payload with blank ids', () => {
    const jwt = makeJwt({
      oid: '   ',
      pid: 'p',
      mid: 'm',
      aud: REQUIRED_AUDIENCE,
      exp: FUTURE_EXP,
    });
    expect(() => parseMemberAccessToken(jwt)).toThrow('oid, pid, and mid');
  });

  it('rejects payload missing exp', () => {
    const { exp, ...withoutExp } = validPayload;
    expect(() => parseMemberAccessToken(makeJwt(withoutExp))).toThrow(
      'must include exp claim',
    );
  });

  it('rejects payload with non-numeric exp', () => {
    const jwt = makeJwt({ ...validPayload, exp: 'tomorrow' });
    expect(() => parseMemberAccessToken(jwt)).toThrow('must include exp claim');
  });

  it('rejects expired tokens', () => {
    const jwt = makeJwt({ ...validPayload, exp: PAST_EXP });
    expect(() => parseMemberAccessToken(jwt)).toThrow('expired');
  });
});
