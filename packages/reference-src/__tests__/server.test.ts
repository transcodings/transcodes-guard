import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { log, createMcpServer } from '../server.ts';
import type { ProxyConfig } from '../config.ts';

const baseConfig: ProxyConfig = {
  backendUrl: 'https://api.test.com',
  apiBaseV1: 'https://api.test.com/v1',
  token: 'jwt',
  organizationId: 'org',
  projectId: 'proj',
  memberId: 'mem',
};

describe('log', () => {
  it('writes to stderr with [transcodes-mcp-server] prefix', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    log('hello', 'world');
    expect(spy).toHaveBeenCalledWith('[transcodes-mcp-server] hello world\n');
    spy.mockRestore();
  });
});

describe('createMcpServer', () => {
  it('returns an McpServer instance', () => {
    const mcp = createMcpServer(baseConfig);
    expect(mcp).toBeInstanceOf(McpServer);
  });
});
