import {
  createServer
} from "../chunk-TCGM6T2Z.js";
import "../chunk-LHLN6C4G.js";

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
    `transcodes-guard-mcp: Streamable HTTP at http://localhost:${PORT}/mcp`
  );
});
