import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request } from '../client.ts';
import type { ProxyConfig } from '../config.ts';

const { axiosFn, isAxiosErrorFn } = vi.hoisted(() => {
  const axiosFn = vi.fn() as ReturnType<typeof vi.fn> & {
    isAxiosError: ReturnType<typeof vi.fn>;
  };
  const isAxiosErrorFn = vi.fn();
  axiosFn.isAxiosError = isAxiosErrorFn;
  return { axiosFn, isAxiosErrorFn };
});

vi.mock('axios', () => ({ default: axiosFn }));

const config: ProxyConfig = {
  backendUrl: 'https://api.test.com',
  apiBaseV1: 'https://api.test.com/v1',
  token: 'test-jwt',
  organizationId: 'org',
  projectId: 'proj',
  memberId: 'mem',
};

beforeEach(() => {
  axiosFn.mockReset();
  isAxiosErrorFn.mockReset();
  // Re-attach isAxiosError (mockReset may clear properties)
  axiosFn.isAxiosError = isAxiosErrorFn;
});

describe('request', () => {
  it('returns ok: true with status and data on success', async () => {
    axiosFn.mockResolvedValue({ status: 200, data: { id: 1 } });

    const result = JSON.parse(
      await request(config, { method: 'GET', path: '/roles' })
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: 1 });
  });

  it('sends x-transcodes-token header carrying the JWT', async () => {
    axiosFn.mockResolvedValue({ status: 200, data: {} });

    await request(config, { method: 'GET', path: '/roles' });

    expect(axiosFn).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-transcodes-token': 'test-jwt' }),
      })
    );
  });

  it('builds URL from apiBaseV1 + path (with leading slash)', async () => {
    axiosFn.mockResolvedValue({ status: 200, data: {} });

    await request(config, { method: 'GET', path: '/project/123' });

    expect(axiosFn).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.test.com/v1/project/123' })
    );
  });

  it('prepends slash to path when missing', async () => {
    axiosFn.mockResolvedValue({ status: 200, data: {} });

    await request(config, { method: 'GET', path: 'project/123' });

    expect(axiosFn).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.test.com/v1/project/123' })
    );
  });

  it('filters out undefined, null, and empty string from query params', async () => {
    axiosFn.mockResolvedValue({ status: 200, data: {} });

    await request(config, {
      method: 'GET',
      path: '/roles',
      query: { page: '1', limit: undefined, q: null, empty: '' },
    });

    expect(axiosFn).toHaveBeenCalledWith(
      expect.objectContaining({ params: { page: '1' } })
    );
  });

  it('does not send body for GET requests', async () => {
    axiosFn.mockResolvedValue({ status: 200, data: {} });

    await request(config, { method: 'GET', path: '/roles', body: { foo: 1 } });

    expect(axiosFn).toHaveBeenCalledWith(
      expect.objectContaining({ data: undefined })
    );
  });

  it('sends body for POST requests', async () => {
    axiosFn.mockResolvedValue({ status: 201, data: {} });

    await request(config, {
      method: 'POST',
      path: '/roles',
      body: { name: 'admin' },
    });

    expect(axiosFn).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'admin' } })
    );
  });

  it('sends x-transcodes-token and JSON body for DELETE (same as POST)', async () => {
    axiosFn.mockResolvedValue({ status: 200, data: {} });

    await request(config, {
      method: 'DELETE',
      path: '/auth/member',
      body: { project_id: 'p1', member_id: 'm1' },
    });

    expect(axiosFn).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        data: { project_id: 'p1', member_id: 'm1' },
        headers: expect.objectContaining({
          'x-transcodes-token': 'test-jwt',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('sends x-transcodes-token when omitBody is true (query-only DELETE)', async () => {
    axiosFn.mockResolvedValue({ status: 200, data: {} });

    await request(config, {
      method: 'DELETE',
      path: '/auth/resources/k',
      query: { project_id: 'p1' },
      omitBody: true,
    });

    expect(axiosFn).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-transcodes-token': 'test-jwt' }),
        data: undefined,
      })
    );
  });

  it('returns ok: false for 4xx/5xx without throwing', async () => {
    axiosFn.mockResolvedValue({ status: 403, data: { error: 'Forbidden' } });

    const result = JSON.parse(
      await request(config, { method: 'GET', path: '/roles' })
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('returns network error with status 0 on rejection', async () => {
    axiosFn.mockRejectedValue(new Error('ENOTFOUND'));
    isAxiosErrorFn.mockReturnValue(false);

    const result = JSON.parse(
      await request(config, { method: 'GET', path: '/roles' })
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.data.message).toContain('Could not reach the backend');
  });

  it('ECONNABORTED → Request timed out', async () => {
    const err = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    axiosFn.mockRejectedValue(err);
    isAxiosErrorFn.mockReturnValue(true);

    const result = JSON.parse(
      await request(config, { method: 'GET', path: '/roles' })
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.data.message).toBe('Request timed out');
  });

  it('sets timeout to 30000ms', async () => {
    axiosFn.mockResolvedValue({ status: 200, data: {} });

    await request(config, { method: 'GET', path: '/roles' });

    expect(axiosFn).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 30_000 })
    );
  });
});
