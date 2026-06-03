/**
 * Microsoft Teams MCP — interfaz pública del módulo
 *
 * Exporta teamsMcp: McpModule para el servidor centralizado.
 *
 * - Mensajería (enviar a chats/canales) → Azure Bot Framework (proactivo).
 *   El bot recibe actividades de Teams en POST /teams/hooks/messages y guarda
 *   las conversation references para reusarlas al enviar.
 * - Directorio y gestión de Teams (listar usuarios/chats, crear/listar Teams,
 *   miembros, canales) → Microsoft Graph (app-only), que no tiene equivalente
 *   en Bot Framework.
 *
 * Las credenciales (TEAMS_TENANT_ID / TEAMS_CLIENT_ID / TEAMS_CLIENT_SECRET, y
 * opcionalmente BOT_APP_ID / BOT_APP_PASSWORD) se leen del .env root del monorepo.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpModule } from "../agent-server/types.ts";
import { initializeTools, registryTool } from "./tools.ts";
import { processActivity } from "./util/bot.ts";
import {
	registryHook,
	getHookCatalog,
	handleSseStream,
	addWebhookSubscription,
	removeWebhookSubscription,
	listWebhookSubscriptions,
} from "./hooks.ts";

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
}

// ─── Hooks handler (montado en /<slug>/hooks* por el servidor central) ────────

async function hooksHandler(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	// Normaliza la ruta relativa al prefijo del módulo (e.g. /template/hooks → /hooks)
	const pathname = ("/" + url.pathname.replace(/^\/[^/]+/, "").replace(/^\//, "")) || "/";
	const method = req.method ?? "GET";

	// POST /hooks/messages  →  endpoint de mensajería del Azure Bot Service
	if (pathname.endsWith("/messages") && method === "POST") {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		let activity: unknown;
		try {
			activity = JSON.parse(Buffer.concat(chunks).toString());
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

	// GET /hooks  →  catálogo completo con payload schemas (discovery)
	if ((pathname === "/" || pathname === "/hooks" || pathname === "") && method === "GET") {
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
				{ id: sub.id, url: sub.url, events: sub.events, createdAt: sub.createdAt },
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
				removed ? { removed: true, id } : { error: "Subscription not found", id },
			),
		);
		return;
	}

	res.writeHead(404, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: "Not Found" }));
}

// ─── Módulo exportado ─────────────────────────────────────────────────────────

export const teamsMcp: McpModule = {
	slug: "teams",
	displayName: "Microsoft Teams",
	credentials: [
		{
			key: "TEAMS_TENANT_ID",
			required: true,
			description: "Directory (tenant) ID de Azure AD",
		},
		{
			key: "TEAMS_CLIENT_ID",
			required: true,
			description: "Application (client) ID de la app registrada en Azure AD",
		},
		{
			key: "TEAMS_CLIENT_SECRET",
			required: true,
			description: "Client secret de la app registrada en Azure AD",
		},
		{
			key: "TEAMS_APP_USER_ID",
			required: false,
			description:
				"ID o userPrincipalName del usuario asociado a la app (service account). Se agrega automáticamente como miembro al crear chats y como owner al crear Teams (requerido por Graph en flujo app-only).",
		},
		{
			key: "GRAPH_BASE_URL",
			required: false,
			description:
				"Base de Microsoft Graph (default: https://graph.microsoft.com/v1.0)",
		},
		{
			key: "BOT_APP_ID",
			required: false,
			description:
				"Microsoft App ID del Azure Bot usado para enviar mensajes a Teams. Default: TEAMS_CLIENT_ID.",
		},
		{
			key: "BOT_APP_PASSWORD",
			required: false,
			description:
				"Client secret del Azure Bot. Default: TEAMS_CLIENT_SECRET.",
		},
		{
			key: "BOT_APP_TYPE",
			required: false,
			description:
				"Tipo de app del bot: SingleTenant | MultiTenant | UserAssignedMSI (default SingleTenant).",
		},
		{
			key: "BOT_TENANT_ID",
			required: false,
			description:
				"Tenant del bot (para SingleTenant). Default: TEAMS_TENANT_ID.",
		},
	],
	// Genera la lista de tools dinámicamente desde el registry
	tools: registryTool.map((t) => ({ name: t.name, description: t.description })),
	// Genera la lista de hooks dinámicamente desde el registry
	hooks: registryHook.map((h) => ({ name: h.name, description: h.description })),
	handler,
	hooksHandler,
};
