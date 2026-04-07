import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { db } from "./src/db/index.ts";
import { seed } from "./src/db/seed.ts";
import { registerTools } from "./tools.ts";

const PORT = Number(process.env.PORT ?? 3000);

// Run seed at startup
await seed();

// ─── HTTP handler ─────────────────────────────────────────────────────────────

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found. Use /mcp" }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const rawBody = Buffer.concat(chunks);

  let parsedBody: unknown;
  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody.toString());
    } catch {
      // non-JSON body — ignore
    }
  }

  try {
    const mcpServer = new McpServer({ name: "document-manager", version: "1.0.0" });
    registerTools(mcpServer, db);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    console.error("[error]", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`MCP document-manager server → http://localhost:${PORT}/mcp`);
});
