import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
/**
 * Builds a fresh MCP server instance with the project's hello-world capabilities.
 *
 * Registers a `hello://world` resource, an `echo` tool, and a `greeting` prompt.
 * The returned server is transport-agnostic — connect it to a `StdioServerTransport`
 * for local Claude Desktop / Code use, or to a `StreamableHTTPServerTransport`
 * for remote `/mcp` deployment.
 */
export function createServer() {
    const server = new McpServer({
        name: "ai-action-tracker-mcp",
        version: "0.1.0",
    });
    server.registerResource("hello-world", "hello://world", {
        title: "Hello World",
        description: "Returns a hello-world greeting.",
        mimeType: "text/plain",
    }, async (uri) => ({
        contents: [{ uri: uri.href, text: "Hello, World!" }],
    }));
    server.registerTool("echo", {
        title: "Echo",
        description: "Echoes the given message back to the caller.",
        inputSchema: { message: z.string() },
    }, async ({ message }) => ({
        content: [{ type: "text", text: `Echo: ${message}` }],
    }));
    server.registerPrompt("greeting", {
        title: "Greeting",
        description: "Generate a greeting addressed to the given name.",
        argsSchema: { name: z.string() },
    }, ({ name }) => ({
        messages: [
            {
                role: "user",
                content: { type: "text", text: `Hello ${name}!` },
            },
        ],
    }));
    return server;
}
//# sourceMappingURL=server.js.map