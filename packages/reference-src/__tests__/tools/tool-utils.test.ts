import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parse,
  blocked,
  blockedWithConsole,
  req,
} from '../../tools/tool-utils.ts';
import { request } from '../../client.ts';
import type { ProxyConfig } from '../../config.ts';

vi.mock('../../client.ts', () => ({
  request: vi.fn(),
}));

const mockedRequest = vi.mocked(request);

/** Minimal ProxyConfig with an endpointMap */
function configWith(map: Record<string, string>): ProxyConfig {
  return {
    backendUrl: 'https://api.test.com',
    apiBaseV1: 'https://api.test.com/v1',
    token: 'jwt',
    organizationId: 'org',
    projectId: 'proj',
    memberId: 'mem',
    endpointMap: new Map(Object.entries(map)),
  };
}

// ─── parse.record ───

describe('parse.record', () => {
  it('returns the object as-is for plain records', () => {
    const obj = { a: 1, b: 'two' };
    expect(parse.record(obj)).toBe(obj);
  });

  it.each([null, undefined, [1, 2], 42, 'str', true])(
    'returns empty object for %s',
    (v) => {
      expect(parse.record(v)).toEqual({});
    }
  );
});

// ─── parse.num ───

describe('parse.num', () => {
  it('returns the number for numeric values', () => {
    expect(parse.num({ page: 5 }, 'page')).toBe(5);
  });

  it('converts numeric string to number', () => {
    expect(parse.num({ page: '42' }, 'page')).toBe(42);
  });

  it('undefined → undefined', () => {
    expect(parse.num({}, 'page')).toBeUndefined();
  });

  it('null → undefined', () => {
    expect(parse.num({ page: null }, 'page')).toBeUndefined();
  });

  it('returns undefined for NaN string', () => {
    expect(parse.num({ page: 'abc' }, 'page')).toBeUndefined();
  });

  it('Infinity → undefined', () => {
    expect(parse.num({ page: Infinity }, 'page')).toBeUndefined();
  });
});

// ─── parse.str ───

describe('parse.str', () => {
  it('returns the string value', () => {
    expect(parse.str({ q: 'hello' }, 'q')).toBe('hello');
  });

  it('returns undefined for non-string values', () => {
    expect(parse.str({ q: 123 }, 'q')).toBeUndefined();
  });

  it('returns undefined for missing key', () => {
    expect(parse.str({}, 'q')).toBeUndefined();
  });
});

// ─── blocked ───

describe('blocked', () => {
  it('returns JSON with ok: false, blocked: true, and message', async () => {
    const result = await blocked('test message');
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({
      ok: false,
      blocked: true,
      message: 'test message',
    });
  });
});

// ─── blockedWithConsole ───

describe('blockedWithConsole', () => {
  it('includes console_url when url is provided', () => {
    const result = JSON.parse(blockedWithConsole('https://console.test.com'));
    expect(result.console_url).toBe('https://console.test.com');
    expect(result.blocked).toBe(true);
  });

  it('omits console_url when url is null', () => {
    const result = JSON.parse(blockedWithConsole(null));
    expect(result).not.toHaveProperty('console_url');
    expect(result.blocked).toBe(true);
  });
});

// ─── req ───

describe('req', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  it('returns blocked JSON when tool is not in endpointMap', async () => {
    const config = configWith({ other_tool: '/other' });
    const result = JSON.parse(
      await req(config, { method: 'GET' }, 'get_project')
    );
    expect(result.blocked).toBe(true);
    expect(result.message).toContain('not enabled');
  });

  it('calls request with correct path from endpointMap', async () => {
    const config = configWith({ get_project: '/project' });
    mockedRequest.mockResolvedValue('{"ok":true,"status":200,"data":{}}');

    await req(config, { method: 'GET' }, 'get_project');

    expect(mockedRequest).toHaveBeenCalledWith(config, {
      method: 'GET',
      path: '/project',
    });
  });

  it('appends pathSuffix to the base path', async () => {
    const config = configWith({ get_project: '/project' });
    mockedRequest.mockResolvedValue('{"ok":true,"status":200,"data":{}}');

    await req(config, { method: 'GET' }, 'get_project', '/123');

    expect(mockedRequest).toHaveBeenCalledWith(config, {
      method: 'GET',
      path: '/project/123',
    });
  });

  it('adds upgradeHint on 403 with plan-limit errorCode', async () => {
    const config = configWith({ get_roles: '/roles' });
    mockedRequest.mockResolvedValue(
      JSON.stringify({
        ok: false,
        status: 403,
        data: { errorCode: 'ROLE_LIMIT_REACHED' },
      })
    );

    const result = JSON.parse(
      await req(config, { method: 'GET' }, 'get_roles')
    );
    expect(result.upgradeHint).toContain('upgrade');
  });

  it('does not add upgradeHint on 403 without plan-limit errorCode', async () => {
    const config = configWith({ get_roles: '/roles' });
    mockedRequest.mockResolvedValue(
      JSON.stringify({
        ok: false,
        status: 403,
        data: { errorCode: 'FORBIDDEN' },
      })
    );

    const result = JSON.parse(
      await req(config, { method: 'GET' }, 'get_roles')
    );
    expect(result).not.toHaveProperty('upgradeHint');
  });
});
