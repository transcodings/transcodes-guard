process.env.AI_ACTION_TRACKER_HOST = "claude-code";
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "@ai-action-tracker/mcp-server-core";

const PORT = Number(process.env.PORT) || 3000;

const httpServer = http.createServer(async (req, res) => {
  if (req.url === "/mcp") {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    req.on("close", () => transport.close());
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found. Use POST /mcp");
});

httpServer.listen(PORT, () => {
  console.error(
    `ai-action-tracker-mcp: Streamable HTTP at http://localhost:${PORT}/mcp`,
  );
});
