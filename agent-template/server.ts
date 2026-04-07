// ─── MCP Server Template ──────────────────────────────────────────────────────
//
// Transport:  Streamable HTTP  →  POST /mcp
// Auth:       mcp-token header (required for all calls except discovery)
// Env:        BASE_URL (fallback), PORT (default 3000)
// Run:        bun run server.ts
//
// [AGENT INSTRUCTIONS]
// 1. Update `AppContext` in types.ts to match your app's per-request data.
// 2. Update `buildHelpers` below to build HTTP helpers from that context.
// 3. Add your tools in tools.ts using `registerTools`.
// 4. Rename the server in `new McpServer({ name: ... })` and in package.json.
//
// The factory pattern (one McpServer per request) ensures each request has its
// own isolated auth context with no shared mutable state across sessions.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { initializeTools, registryTool } from "./tools.ts";
import { envs } from "./util/envs.ts";

const DEFAULT_BASE_URL = (envs.BASE_URL ?? "").replace(/\/$/, "");
const PORT = Number(envs.PORT ?? 3000);

// ─── HTTP handler ─────────────────────────────────────────────────────────────
const httpServer = createServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		if (!req.url?.startsWith("/mcp")) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not Found. Use /mcp" }));
			return;
		}

		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const rawBody = Buffer.concat(chunks);

		let parsedBody: unknown;
		let rpcMethod: string | undefined;
		if (rawBody.length > 0) {
			try {
				parsedBody = JSON.parse(rawBody.toString());
				rpcMethod = (parsedBody as { method?: string }).method;
			} catch {
				// non-JSON body (e.g. SSE GET) — no method to inspect
			}
		}

		// tools/list and initialize only need tool schemas, not real API access
		const isDiscovery =
			rpcMethod === "tools/list" || rpcMethod === "initialize";

		try {
			const mcpServer = new McpServer({
				name: "mcp-template",
				version: "1.0.0",
			});
			initializeTools(mcpServer);

			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
			});
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
	},
);

httpServer.listen(PORT, () => {
	console.log(`✓ MCP server → http://localhost:${PORT}/mcp`);
	console.log(`  BASE_URL: ${DEFAULT_BASE_URL || "(use mcp-base-url header)"}`);
	for (const tool of registryTool) {
		console.log(`  • ${tool.name.padEnd(25, " ")} — ${tool.description}`);
	}
});
