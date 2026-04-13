// ─── MCP Server Template ──────────────────────────────────────────────────────
//
// Transport:  Streamable HTTP  →  POST /mcp
// Hooks:      REST + SSE      →  /hooks/*
// Auth:       mcp-token header (required for all calls except discovery)
// Env:        BASE_URL (fallback), PORT (default 3000)
// Run:        bun run server.ts
//
// [AGENT INSTRUCTIONS]
// 1. Update `AppContext` in types.ts to match your app's per-request data.
// 2. Update `buildHelpers` below to build HTTP helpers from that context.
// 3. Add your tools in tools.ts using `registerTools`.
// 4. Add your hooks in hooks.ts; emit them from tool handlers via `emit()`.
// 5. Rename the server in `new McpServer({ name: ... })` and in package.json.
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
import {
	registryHook,
	getHookCatalog,
	handleSseStream,
	addWebhookSubscription,
	removeWebhookSubscription,
	listWebhookSubscriptions,
	registerHookPersister,
} from "./hooks.ts";
import { envs } from "./util/envs.ts";
import { db, initializeDatabase } from "./db/index.ts";
import { sentHooks } from "./db/schema.ts";
import { startMonitor } from "./git/git.monitor.ts";

const DEFAULT_BASE_URL = (envs.BASE_URL ?? "").replace(/\/$/, "");
const PORT = Number(envs.PORT ?? 4000);

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

	// GET /hooks  →  full hook catalog with payload schemas (discovery)
	if (pathname === "/hooks" && method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(getHookCatalog(), null, 2));
		return;
	}

	// GET /hooks/stream[?event=<name>]  →  SSE stream of emitted events
	if (pathname === "/hooks/stream" && method === "GET") {
		handleSseStream(req, res);
		return; // connection stays open
	}

	// GET /hooks/subscriptions  →  list active webhook subscriptions
	if (pathname === "/hooks/subscriptions" && method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(listWebhookSubscriptions(), null, 2));
		return;
	}

	// POST /hooks/subscriptions  →  create a new webhook subscription
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
		res.end(JSON.stringify({ id: sub.id, url: sub.url, events: sub.events, createdAt: sub.createdAt }, null, 2));
		return;
	}

	// DELETE /hooks/subscriptions/:id  →  remove a webhook subscription
	const deleteMatch = pathname.match(/^\/hooks\/subscriptions\/([^/]+)$/);
	if (deleteMatch && method === "DELETE") {
		const id = deleteMatch[1];
		const removed = removeWebhookSubscription(id);
		if (removed) {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ removed: true, id }));
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Subscription not found", id }));
		}
		return;
	}

	res.writeHead(404, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: "Not Found" }));
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

const httpServer = createServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

		// ── Hooks routes ──────────────────────────────────────────────────────
		if (pathname.startsWith("/hooks")) {
			await handleHooksRoute(req, res);
			return;
		}

		// ── MCP route ─────────────────────────────────────────────────────────
		if (!pathname.startsWith("/mcp")) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not Found. Use /mcp or /hooks" }));
			return;
		}

		const rawBody = await readBody(req);

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

// ─── Bootstrap ────────────────────────────────────────────────────────────────

// 1. Create SQLite tables (idempotent)
initializeDatabase();

// 2. Register hook persister — stores every emitted hook in sent_hooks table
registerHookPersister(async (name, payload) => {
	const repositoryId =
		(payload as Record<string, unknown> | null)?.repository &&
		typeof (payload as Record<string, { id?: string }>).repository === "object"
			? ((payload as Record<string, { id?: string }>).repository.id ?? null)
			: null;

	await db.insert(sentHooks).values({
		id: crypto.randomUUID(),
		hookName: name,
		payload: JSON.stringify(payload),
		repositoryId,
		sentAt: new Date().toISOString(),
	});
});

// 3. Start git polling monitor
startMonitor(envs.GIT_POLL_INTERVAL);

httpServer.listen(PORT, () => {
	console.log(`✓ MCP server  → http://localhost:${PORT}/mcp`);
	console.log(`✓ Hooks API   → http://localhost:${PORT}/hooks`);
	console.log(`  BASE_URL: ${DEFAULT_BASE_URL || "(use mcp-base-url header)"}`);
	console.log(`  Git poll:  every ${envs.GIT_POLL_INTERVAL} minute(s)`);
	console.log("  Tools:");
	for (const tool of registryTool) {
		console.log(`    • ${tool.name.padEnd(28, " ")} — ${tool.description.slice(0, 60)}`);
	}
	console.log("  Hooks:");
	for (const hook of registryHook) {
		console.log(`    • ${hook.name.padEnd(28, " ")} — ${hook.description}`);
	}
});
