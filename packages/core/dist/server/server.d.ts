import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type GateBackend } from '../contract/index.js';
export { coreToolDefinitions } from './tool-definitions.js';
export declare function createServer(backend?: GateBackend): McpServer;
