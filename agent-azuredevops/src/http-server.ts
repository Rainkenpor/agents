#!/usr/bin/env bun
import http from "node:http";
import { handler } from "./index.js";

const host = process.env["HOST"] || "127.0.0.1";
const port = Number(process.env["PORT"] || "8787");

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      if (!body.trim()) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing request URL" }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
    return;
  }

  try {
    const parsedBody = req.method === "POST" ? await readJsonBody(req) : undefined;
    await handler(req, res, parsedBody);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }
});

server.listen(port, host, () => {
  process.stderr.write(`[agent-azuredevops] MCP Streamable HTTP server listening on http://${host}:${port}/mcp\n`);
});
