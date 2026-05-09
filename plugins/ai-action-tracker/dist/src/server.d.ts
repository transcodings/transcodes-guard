import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Builds a fresh MCP server instance with the project's hello-world capabilities.
 *
 * Registers a `hello://world` resource, an `echo` tool, and a `greeting` prompt.
 * The returned server is transport-agnostic — connect it to a `StdioServerTransport`
 * for local Claude Desktop / Code use, or to a `StreamableHTTPServerTransport`
 * for remote `/mcp` deployment.
 */
export declare function createServer(): McpServer;
