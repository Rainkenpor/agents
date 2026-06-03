// ─── Microsoft Teams MCP Server (standalone) ──────────────────────────────────
//
// Transport:  Streamable HTTP  →  POST /mcp
// Hooks:      REST + SSE       →  /hooks/*
// Env:        TEAMS_TENANT_ID / TEAMS_CLIENT_ID / TEAMS_CLIENT_SECRET (root .env)
// Run:        bun run server.ts
//
// Para desarrollo standalone carga el .env de la carpeta root del monorepo.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import dotenv from "dotenv";
import { initializeTools, registryTool } from "./tools.ts";
import {
	registryHook,
	getHookCatalog,
	handleSseStream,
	addWebhookSubscription,
	removeWebhookSubscription,
	listWebhookSubscriptions,
} from "./hooks.ts";
import { envs } from "./util/envs.ts";
import { processActivity } from "./util/bot.ts";

// Carga credenciales del .env root (igual que agent-server)
dotenv.config({ path: "../.env" });

const PORT = envs.PORT;

// ─── Body reader ─────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

// ─── Hook routes ──────────────────────────────────────────────────────────────

async function handleHooksRoute(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const pathname = url.pathname;
	const method = req.method ?? "GET";

	if (pathname === "/hooks" && method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(getHookCatalog(), null, 2));
		return;
	}

	if (pathname === "/hooks/stream" && method === "GET") {
		handleSseStream(req, res);
		return;
	}

	if (pathname === "/hooks/subscriptions" && method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(listWebhookSubscriptions(), null, 2));
		return;
	}

	if (pathname === "/hooks/subscriptions" && method === "POST") {
		const raw = await readBody(req);
		let body: { url?: string; events?: string[]; secret?: string };
		try {
			body = JSON.parse(raw.toString());
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Invalid JSON body" }));
			return;
		}
		if (!body.url || typeof body.url !== "string") {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "`url` is required" }));
			return;
		}
		const events: string[] = Array.isArray(body.events) ? body.events : [];
		const sub = addWebhookSubscription(body.url, events, body.secret);
		res.writeHead(201, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify(
				{ id: sub.id, url: sub.url, events: sub.events, createdAt: sub.createdAt },
				null,
				2,
			),
		);
		return;
	}

	const deleteMatch = pathname.match(/^\/hooks\/subscriptions\/([^/]+)$/);
	if (deleteMatch && method === "DELETE") {
		const id = deleteMatch[1];
		const removed = removeWebhookSubscription(id);
		res.writeHead(removed ? 200 : 404, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify(
				removed ? { removed: true, id } : { error: "Subscription not found", id },
			),
		);
		return;
	}

	res.writeHead(404, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: "Not Found" }));
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

const httpServer = createServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

		// ── Bot Framework: endpoint de mensajería de Azure Bot Service ──────────────
		if (
			(pathname === "/messages" || pathname === "/hooks/messages") &&
			(req.method ?? "GET") === "POST"
		) {
			const raw = await readBody(req);
			let activity: unknown;
			try {
				activity = JSON.parse(raw.toString());
			} catch {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Invalid JSON activity" }));
				return;
			}
			try {
				await processActivity(req, res, activity);
			} catch (err) {
				console.error("[teams] bot error:", err);
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: String(err) }));
				}
			}
			return;
		}

		if (pathname.startsWith("/hooks")) {
			await handleHooksRoute(req, res);
			return;
		}

		if (!pathname.startsWith("/mcp")) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not Found. Use /mcp or /hooks" }));
			return;
		}

		const rawBody = await readBody(req);

		let parsedBody: unknown;
		if (rawBody.length > 0) {
			try {
				parsedBody = JSON.parse(rawBody.toString());
			} catch {
				// non-JSON body (e.g. SSE GET)
			}
		}

		try {
			const mcpServer = new McpServer({ name: "teams-mcp", version: "1.0.0" });
			initializeTools(mcpServer);
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
			});
			res.on("close", () => transport.close());
			await mcpServer.connect(transport);
			await transport.handleRequest(req, res, parsedBody);
		} catch (err) {
			console.error("[teams] error:", err);
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: String(err) }));
			}
		}
	},
);

httpServer.listen(PORT, () => {
	console.log(`✓ Teams MCP server  → http://localhost:${PORT}/mcp`);
	console.log(`✓ Hooks API         → http://localhost:${PORT}/hooks`);
	console.log(`✓ Bot messaging     → http://localhost:${PORT}/messages`);
	console.log(
		`  Tenant: ${envs.TENANT_ID || "(falta TEAMS_TENANT_ID en root .env)"}`,
	);
	console.log("  Tools:");
	for (const tool of registryTool) {
		console.log(`    • ${tool.name.padEnd(28, " ")} — ${tool.description}`);
	}
	console.log("  Hooks:");
	for (const hook of registryHook) {
		console.log(`    • ${hook.name.padEnd(28, " ")} — ${hook.description}`);
	}
});
