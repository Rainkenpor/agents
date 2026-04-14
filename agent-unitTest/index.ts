/**
 * MCP Template — interfaz pública del módulo
 *
 * Exporta templateMcp: McpModule para el servidor centralizado.
 * Sirve de referencia/starter kit para crear nuevos MCPs.
 *
 * [INSTRUCCIONES]
 * 1. Copiar esta carpeta completa con un nuevo nombre (ej. agent-miodominio)
 * 2. Actualizar slug, displayName, tools, hooks y credentials
 * 3. Implementar el handler con la lógica del server.ts de tu dominio
 * 4. Registrar en agent-server/registry.ts
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
} from "./hooks.ts";
import { envs } from "./util/envs.ts";

// ─── MCP handler (extraído de server.ts, sin chequeo de URL ni listen) ────────

async function handler(
	req: IncomingMessage,
	res: ServerResponse,
	parsedBody: unknown | Record<string, unknown>,
): Promise<void> {
	let rpcMethod: string | undefined;
	if (parsedBody && typeof parsedBody === "object") {
		try {
			rpcMethod = (parsedBody as { method?: string }).method;
		} catch {
			// body no es JSON (p.ej. GET de SSE)
		}
	}

	// isDiscovery indica si se desea solo listar las tools existentes
	const isDiscovery = rpcMethod === "tools/list" || rpcMethod === "initialize";

	try {
		const mcpServer = new McpServer({ name: "mcp-template", version: "1.0.0" });
		initializeTools(mcpServer);
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});
		res.on("close", () => transport.close());
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res, parsedBody);
	} catch (err) {
		console.error("[template] error:", err);
		if (!res.headersSent) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		}
	}
}

// ─── Hooks handler (montado en /<slug>/hooks* por el servidor central) ────────

async function hooksHandler(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	// Normaliza la ruta relativa al prefijo del módulo (e.g. /template/hooks → /hooks)
	const pathname =
		`/${url.pathname.replace(/^\/[^/]+/, "").replace(/^\//, "")}` || "/";
	const method = req.method ?? "GET";

	// GET /hooks  →  catálogo completo con payload schemas (discovery)
	if (
		(pathname === "/" || pathname === "/hooks" || pathname === "") &&
		method === "GET"
	) {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(getHookCatalog(), null, 2));
		return;
	}

	// GET /hooks/stream[?event=<name>]  →  SSE stream
	if (pathname.endsWith("/stream") && method === "GET") {
		handleSseStream(req, res);
		return;
	}

	// GET /hooks/subscriptions  →  listar webhooks
	if (pathname.endsWith("/subscriptions") && method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(listWebhookSubscriptions(), null, 2));
		return;
	}

	// POST /hooks/subscriptions  →  registrar webhook
	if (pathname.endsWith("/subscriptions") && method === "POST") {
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

	// DELETE /hooks/subscriptions/:id  →  eliminar webhook
	const deleteMatch = pathname.match(/\/subscriptions\/([^/]+)$/);
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

export const unitTestMCP: McpModule = {
	slug: "unit-test",
	displayName: "Unit Test MCP",
	credentials: [],
	// Genera la lista de tools dinámicamente desde el registry
	tools: registryTool.map((t) => ({
		name: t.name,
		description: t.description,
	})),
	// Genera la lista de hooks dinámicamente desde el registry
	hooks: registryHook.map((h) => ({
		name: h.name,
		description: h.description,
	})),
	handler,
	hooksHandler,
};
