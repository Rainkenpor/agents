#!/usr/bin/env bun
// ─── HTTP Server ──────────────────────────────────────────────────────────────
//
// Transport:  Streamable HTTP  →  POST /mcp
// Env:        PORT (default 8787), HOST (default 127.0.0.1)
// Run:        bun run start:http

import { createServer } from "node:http";
import { agentAzureDevOpsMcp } from "./index.js";
import { envs } from "./util/envs.js";
import { registryTool } from "./tools.js";

const { PORT, HOST } = envs;

const httpServer = createServer(async (req, res) => {
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
      // non-JSON body (e.g. SSE GET) — no method to inspect
    }
  }

  await agentAzureDevOpsMcp.handler(req, res, parsedBody);
});

httpServer.listen(PORT, HOST, () => {
  console.log(`✓ MCP server → http://${HOST}:${PORT}/mcp`);
  for (const tool of registryTool) {
    console.log(`  • ${tool.name.padEnd(35, " ")} — ${tool.description}`);
  }
});
