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

const INSTRUCTIONS = `
# agent-datadog

Servidor MCP para Datadog. Permite gestionar monitores, incidentes, métricas, logs, dashboards, eventos, SLOs y hosts.

## Reglas

- Las credenciales (API key y Application key) viajan en cada request como headers HTTP: mcp-api-key y mcp-application-key.
- No existe almacenamiento de credenciales en el servidor.
- Usa datadog_list_monitors / datadog_get_monitor para consultar el estado de alertas.
- Usa datadog_create_incident / datadog_update_incident para gestionar incidentes activos.
- Usa datadog_query_metrics para analizar datos de series de tiempo.
- Usa datadog_search_logs / datadog_aggregate_logs para investigar logs.
- Usa datadog_list_slos / datadog_get_slo_history para evaluar disponibilidad de servicios.
`.trim();

// ─── MCP handler ──────────────────────────────────────────────────────────────

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
			// body is not JSON
		}
	}

	const isDiscovery = rpcMethod === "tools/list" || rpcMethod === "initialize";

	const apiKeyHeader = req.headers["mcp-api-key"];
	const appKeyHeader = req.headers["mcp-application-key"];
	const apiKey = Array.isArray(apiKeyHeader)
		? apiKeyHeader[0]
		: (apiKeyHeader ?? "");
	const appKey = Array.isArray(appKeyHeader)
		? appKeyHeader[0]
		: (appKeyHeader ?? "");

	if ((!apiKey || !appKey) && !isDiscovery) {
		if (!res.headersSent) {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					error:
						"Missing credentials: mcp-api-key and mcp-application-key headers are required",
				}),
			);
		}
		return;
	}

	try {
		const mcpServer = new McpServer(
			{ name: "agent-datadog", version: "1.0.0" },
			{ instructions: INSTRUCTIONS },
		);
		initializeTools(mcpServer, apiKey, appKey);
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});
		res.on("close", () => transport.close());
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res, parsedBody);
	} catch (err) {
		console.error("[agent-datadog] error:", err);
		if (!res.headersSent) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		}
	}
}

// ─── Hooks handler ────────────────────────────────────────────────────────────

async function hooksHandler(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const pathname =
		"/" + url.pathname.replace(/^\/[^/]+/, "").replace(/^\//, "") || "/";
	const method = req.method ?? "GET";

	if (
		(pathname === "/" || pathname === "/hooks" || pathname === "") &&
		method === "GET"
	) {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(getHookCatalog(), null, 2));
		return;
	}

	if (pathname.endsWith("/stream") && method === "GET") {
		handleSseStream(req, res);
		return;
	}

	if (pathname.endsWith("/subscriptions") && method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(listWebhookSubscriptions(), null, 2));
		return;
	}

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

// ─── Module export ────────────────────────────────────────────────────────────

export const datadogMcp: McpModule = {
	slug: "datadog",
	displayName: "Agent Datadog",
	credentials: [],
	tools: registryTool.map((t) => ({
		name: t.name,
		description: t.description,
	})),
	hooks: registryHook.map((h) => ({
		name: h.name,
		description: h.description,
	})),
	handler,
	hooksHandler,
};

export default datadogMcp;
