import {
  createServer
} from "../chunk-X5OL5HI3.js";
import "../chunk-DMIBEVDC.js";

// src/http.ts
import http from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
var PORT = Number(process.env.PORT) || 3e3;
var httpServer = http.createServer(async (req, res) => {
  if (req.url === "/mcp") {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: void 0
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
    `ai-action-tracker-mcp: Streamable HTTP at http://localhost:${PORT}/mcp`
  );
});
