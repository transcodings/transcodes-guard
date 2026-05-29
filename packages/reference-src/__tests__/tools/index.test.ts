import { describe, it, expect } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getMcpTools, dispatchTool } from '../../tools/index.ts';
import type { ProxyConfig } from '../../config.ts';

/** ALWAYS_VISIBLE proxy tool names */
const PROXY_TOOL_NAMES = [
  'start_tunnel',
  'stop_tunnel',
  'get_tunnel_status',
  'get_current_project_id',
  'get_current_organization_id',
  'get_current_member_id',
  'get_my_profile',
  'get_console_url',
];

const baseConfig: ProxyConfig = {
  backendUrl: 'https://api.test.com',
  apiBaseV1: 'https://api.test.com/v1',
  token: 'jwt',
  organizationId: 'org',
  projectId: 'proj',
  memberId: 'mem',
  endpointMap: new Map(),
};

describe('getMcpTools', () => {
  it('returns only proxy tools when endpointMap is empty', () => {
    const tools = getMcpTools(baseConfig);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(PROXY_TOOL_NAMES));
    expect(names.length).toBe(PROXY_TOOL_NAMES.length);
  });

  it('includes tools present in endpointMap', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      endpointMap: new Map([['get_project', '/project']]),
    };
    const tools = getMcpTools(config);
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_project');
    expect(names.length).toBe(PROXY_TOOL_NAMES.length + 1);
  });

  it('strips handler property from returned tools', () => {
    const tools = getMcpTools(baseConfig);
    for (const tool of tools) {
      expect(tool).not.toHaveProperty('handler');
    }
  });
});

describe('dispatchTool', () => {
  it('throws McpError(MethodNotFound) for unknown tool', async () => {
    await expect(
      dispatchTool('nonexistent_tool', {}, baseConfig)
    ).rejects.toThrow(McpError);

    try {
      await dispatchTool('nonexistent_tool', {}, baseConfig);
    } catch (e) {
      expect(e).toBeInstanceOf(McpError);
      expect((e as McpError).code).toBe(ErrorCode.MethodNotFound);
    }
  });

  it('dispatches ALWAYS_VISIBLE tool successfully', async () => {
    const result = await dispatchTool('get_current_project_id', {}, baseConfig);
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.project_id).toBe('proj');
  });

  it('throws McpError for non-ALWAYS_VISIBLE tool not in endpointMap', async () => {
    const config: ProxyConfig = {
      ...baseConfig,
      endpointMap: new Map([['other_tool', '/other']]),
    };
    await expect(dispatchTool('get_project', {}, config)).rejects.toThrow(
      McpError
    );
  });
});
