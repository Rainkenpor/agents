/**
 * Agent Hook — interfaz pública del módulo MCP
 *
 * Exporta `hooksMcp: McpModule` para que agent-server lo monte en:
 *   POST  /hooks/mcp          → MCP JSON-RPC (tools)
 *   GET   /hooks/hooks        → catálogo de hooks
 *   GET   /hooks/hooks/stream → SSE stream de eventos
 *   *     /hooks/hooks/*      → gestión de webhooks
 *
 * El hook onStartup:
 *   1. Inicializa la base de datos SQLite (tablas + índices)
 *   2. Registra el persister que guarda cada hook emitido en sent_hooks
 *   3. Arranca el monitor de repositorios Git (polling configurable)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpModule } from "../agent-server/types.ts";
import { initializeTools, registryTool } from "./tools.ts";
import {
	registryHook,
	getHookCatalog,
	handleSseStream,
	addWebhookSubscription,
	removeWebhookSubscription,
	listWebhookSubscriptions,
	registerHookPersister,
	registerWebhookFailureHandler,
} from "./hooks.ts";
import {
	savePendingDelivery,
	startRetryScheduler,
} from "./hooks/webhook.retry.ts";
import { envs } from "./util/envs.ts";
import { db, initializeDatabase } from "./db/index.ts";
import { sentHooks } from "./db/schema.ts";
import { startMonitor } from "./git/git.monitor.ts";

// ─── onStartup ────────────────────────────────────────────────────────────────

async function onStartup(): Promise<void> {
	// 1. Crear tablas SQLite si no existen
	initializeDatabase();

	// 2. Persister: guarda cada hook emitido en la tabla sent_hooks
	registerHookPersister(async (name, payload) => {
		const repositoryId =
			payload !== null &&
			typeof payload === "object" &&
			"repository" in payload &&
			typeof (payload as Record<string, unknown>).repository === "object" &&
			(payload as Record<string, { id?: string }>).repository !== null
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

	// 3. Registrar handler de fallos — guarda entregas fallidas para reintento
	registerWebhookFailureHandler(savePendingDelivery);

	// 4. Arrancar scheduler de reintentos — flush inmediato al inicio, luego cada 20 min
	startRetryScheduler(envs.GIT_POLL_INTERVAL);

	// 5. Arrancar el monitor de repositorios Git
	startMonitor(envs.GIT_POLL_INTERVAL);
}

// ─── MCP handler ──────────────────────────────────────────────────────────────

async function handler(
	req: IncomingMessage,
	res: ServerResponse,
	parsedBody: unknown,
): Promise<void> {
	try {
		const mcpServer = new McpServer({ name: "agent-hook", version: "1.0.0" });
		initializeTools(mcpServer);
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});
		res.on("close", () => transport.close());
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res, parsedBody);
	} catch (err) {
		console.error("[hooks] MCP handler error:", err);
		if (!res.headersSent) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		}
	}
}

// ─── Hooks HTTP handler ───────────────────────────────────────────────────────

async function hooksHandler(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	// Normaliza la ruta quitando el prefijo del slug (ej. /hooks/hooks/stream → /stream)
	const pathname =
		"/" +
			url.pathname
				.replace(/^\/[^/]+/, "") // quita /hooks
				.replace(/^\/hooks/, "") // quita /hooks (subruta)
				.replace(/^\//, "") || "/";
	const method = req.method ?? "GET";

	// GET /  →  catálogo completo de hooks (discovery)
	if ((pathname === "/" || pathname === "") && method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(getHookCatalog(), null, 2));
		return;
	}

	// GET /stream  →  SSE stream en tiempo real
	if (pathname === "/stream" && method === "GET") {
		handleSseStream(req, res);
		return;
	}

	// GET /subscriptions  →  listar webhooks activos
	if (pathname === "/subscriptions" && method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(listWebhookSubscriptions(), null, 2));
		return;
	}

	// POST /subscriptions  →  registrar webhook
	if (pathname === "/subscriptions" && method === "POST") {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		let body: { url?: string; events?: string[]; secret?: string };
		try {
			body = JSON.parse(Buffer.concat(chunks).toString());
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
		const sub = addWebhookSubscription(
			body.url,
			Array.isArray(body.events) ? body.events : [],
			body.secret,
		);
		res.writeHead(201, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify(
				{
					id: sub.id,
					url: sub.url,
					events: sub.events,
					createdAt: sub.createdAt,
				},
				null,
				2,
			),
		);
		return;
	}

	// DELETE /subscriptions/:id  →  eliminar webhook
	const deleteMatch = pathname.match(/^\/subscriptions\/([^/]+)$/);
	if (deleteMatch && method === "DELETE") {
		const id = deleteMatch[1];
		const removed = removeWebhookSubscription(id);
		res.writeHead(removed ? 200 : 404, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify(
				removed
					? { removed: true, id }
					: { error: "Subscription not found", id },
			),
		);
		return;
	}

	res.writeHead(404, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: "Not Found" }));
}

// ─── Módulo exportado ─────────────────────────────────────────────────────────

export const eventSourceMcp: McpModule = {
	slug: "event-source",
	displayName: "Agent Event Source — Git Monitor & Webhooks",
	credentials: [
		{
			key: "GIT_POLL_INTERVAL_MINUTES",
			required: false,
			description: `Intervalo de polling en minutos para repositorios Git (default: 20)`,
		},
	],
	tools: registryTool.map((t) => ({ name: t.name, description: t.description })),
	hooks: registryHook.map((h) => ({ name: h.name, description: h.description })),
	onStartup,
	handler,
	hooksHandler,
};
