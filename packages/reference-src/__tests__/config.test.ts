import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadConfig } from '../config.ts';
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_ENDPOINT_MAP,
} from '../constants.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.x`;
}

function stubValidToken() {
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  vi.stubEnv(
    'TRANSCODES_TOKEN',
    makeJwt({
      oid: 'org-1',
      pid: 'proj-1',
      mid: 'mem-1',
      aud: 'transcodes-mcp',
      exp: futureExp,
    }),
  );
}

describe('loadConfig', () => {
  it('throws when TRANSCODES_TOKEN is missing', () => {
    vi.stubEnv('TRANSCODES_BACKEND_URL', 'https://api.example.com');
    vi.stubEnv('TRANSCODES_TOKEN', '');
    expect(() => loadConfig()).toThrow('TRANSCODES_TOKEN is required');
  });

  it('falls back to DEFAULT_BACKEND_URL when TRANSCODES_BACKEND_URL is missing', () => {
    stubValidToken();
    vi.stubEnv('TRANSCODES_BACKEND_URL', '');
    const config = loadConfig();
    expect(config.backendUrl).toBe(DEFAULT_BACKEND_URL);
    expect(config.apiBaseV1).toBe(`${DEFAULT_BACKEND_URL}/v1`);
  });

  it('env TRANSCODES_BACKEND_URL overrides the default', () => {
    stubValidToken();
    vi.stubEnv('TRANSCODES_BACKEND_URL', 'https://api.example.com');
    const config = loadConfig();
    expect(config.backendUrl).toBe('https://api.example.com');
  });

  it('throws on invalid URL', () => {
    stubValidToken();
    vi.stubEnv('TRANSCODES_BACKEND_URL', 'not-a-url');
    expect(() => loadConfig()).toThrow('not a valid URL');
  });

  it('strips trailing slash from backendUrl', () => {
    stubValidToken();
    vi.stubEnv('TRANSCODES_BACKEND_URL', 'https://api.example.com/');
    const config = loadConfig();
    expect(config.backendUrl).toBe('https://api.example.com');
  });

  it('sets ids and token from TRANSCODES_TOKEN', () => {
    stubValidToken();
    vi.stubEnv('TRANSCODES_BACKEND_URL', 'https://api.example.com');
    const config = loadConfig();
    expect(config.organizationId).toBe('org-1');
    expect(config.projectId).toBe('proj-1');
    expect(config.memberId).toBe('mem-1');
    expect(config.token).toBeTruthy();
  });

  it('always builds endpointMap from DEFAULT_ENDPOINT_MAP', () => {
    stubValidToken();
    vi.stubEnv('TRANSCODES_BACKEND_URL', 'https://api.example.com');
    const config = loadConfig();
    const defaultKeys = Object.keys(DEFAULT_ENDPOINT_MAP);
    expect(config.endpointMap.size).toBe(defaultKeys.length);
    expect(config.endpointMap.get('get_project')).toBe('/project');
    expect(config.endpointMap.get('get_member')).toBe('/auth/member');
    expect(config.endpointMap.get('membership_plans')).toBe('/membership/plans');
  });
});
