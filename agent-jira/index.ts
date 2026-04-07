/**
 * Atlassian MCP — interfaz pública del módulo
 *
 * Exporta jiraMcp: McpModule para el servidor centralizado.
 * La lógica HTTP (body parsing, validación de headers, factory McpServer)
 * es idéntica a server.ts, pero sin el chequeo de URL ni el httpServer.listen.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpModule } from "../agent-server/types.ts";
import type { AtlassianContext } from "./types.ts";
import { registerTools } from "./tools.ts";

// ─── Configuración ────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = (process.env.ATLASSIAN_BASE_URL ?? "").replace(/\/$/, "");

// ─── Factory del servidor MCP (una instancia por request) ─────────────────────

function buildServer(ctx: AtlassianContext): McpServer {
	const { baseUrl, email, token } = ctx;

	function authHeaders(): Record<string, string> {
		const creds = Buffer.from(`${email}:${token}`).toString("base64");
		return {
			Authorization: `Basic ${creds}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		};
	}

	const jiraUrl = (p: string) => `${baseUrl}/rest/api/3/${p.replace(/^\//, "")}`;
	const agileUrl = (p: string) => `${baseUrl}/rest/agile/1.0/${p.replace(/^\//, "")}`;
	const cfluUrl = (p: string) => `${baseUrl}/wiki/rest/api/${p.replace(/^\//, "")}`;
	const rawUrl = (p: string) => `${baseUrl}${p}`;

	async function apiGet(url: string, params: Record<string, unknown> = {}) {
		const u = new URL(url);
		for (const [k, v] of Object.entries(params))
			if (v != null) u.searchParams.set(k, String(v));
		const r = await fetch(u.toString(), { headers: authHeaders() });
		if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
		return r.json();
	}

	async function apiPost(url: string, body?: unknown) {
		const r = await fetch(url, {
			method: "POST",
			headers: authHeaders(),
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
		const text = await r.text();
		return text ? JSON.parse(text) : { status: "ok" };
	}

	async function apiPut(url: string, body?: unknown) {
		const r = await fetch(url, {
			method: "PUT",
			headers: authHeaders(),
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
		const text = await r.text();
		return text ? JSON.parse(text) : { status: "ok" };
	}

	async function apiDelete(url: string, params: Record<string, unknown> = {}) {
		const u = new URL(url);
		for (const [k, v] of Object.entries(params))
			if (v != null) u.searchParams.set(k, String(v));
		const r = await fetch(u.toString(), { method: "DELETE", headers: authHeaders() });
		if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
		return { status: "deleted" };
	}

	const s = new McpServer({ name: "atlassian-mcp", version: "1.0.0" });
	registerTools(s, {
		jiraUrl, agileUrl, cfluUrl, rawUrl,
		apiGet, apiPost, apiPut, apiDelete, authHeaders,
	});
	return s;
}

// ─── Handler HTTP (extraído de server.ts, sin chequeo de URL ni listen) ───────

async function handler(req: IncomingMessage, res: ServerResponse, parsedBody: unknown | Record<string,any>): Promise<void> {
	let rpcMethod: string | undefined;
	if (parsedBody && typeof parsedBody === "object") {
		try {
			rpcMethod = (parsedBody as { method?: string }).method;
		} catch {
			// body no es JSON (p.ej. GET de SSE)
		}
	}

	const isDiscovery = rpcMethod === "tools/list" || rpcMethod === "initialize";

	const token = req.headers["mcp-token"];
	const email = req.headers["mcp-email"];

	if (!isDiscovery) {
		if (!token || typeof token !== "string") {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Missing required header: mcp-token" }));
			return;
		}
		if (!email || typeof email !== "string") {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Missing required header: mcp-email" }));
			return;
		}
	}

	const rawBaseUrl = req.headers["mcp-base-url"];
	const baseUrl = (typeof rawBaseUrl === "string" ? rawBaseUrl : DEFAULT_BASE_URL).replace(/\/$/, "");
	if (!isDiscovery && !baseUrl) {
		res.writeHead(400, { "Content-Type": "application/json" });
		res.end(JSON.stringify({
			error: "Missing Atlassian base URL: set ATLASSIAN_BASE_URL or send mcp-base-url header",
		}));
		return;
	}

	try {
		const mcpServer = buildServer({
			baseUrl: baseUrl || "https://placeholder.atlassian.net",
			email: typeof email === "string" ? email : "",
			token: typeof token === "string" ? token : "",
		});
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => transport.close());
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res, parsedBody);
	} catch (err) {
		console.error("[jira] error:", err);
		if (!res.headersSent) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		}
	}
}

// ─── Módulo exportado ─────────────────────────────────────────────────────────

export const jiraMcp: McpModule = {
	slug: "jira",
	displayName: "Atlassian Jira & Confluence",
	credentials: [
		{
			key: "ATLASSIAN_BASE_URL",
			required: false,
			description: "Base URL de Atlassian (alternativa al header mcp-base-url por request)",
		},
	],
	tools: [
		// ── Jira Issues
		{ name: "jira_get_issue",              description: "Obtiene los detalles completos de un issue de Jira" },
		{ name: "jira_search_issues",          description: "Busca issues usando JQL (Jira Query Language)" },
		{ name: "jira_create_issue",           description: "Crea un nuevo issue en Jira" },
		{ name: "jira_update_issue",           description: "Actualiza campos de un issue existente" },
		{ name: "jira_delete_issue",           description: "Elimina un issue de Jira" },
		{ name: "jira_assign_issue",           description: "Asigna o desasigna un issue" },
		{ name: "jira_get_issue_changelog",    description: "Obtiene el historial de cambios de un issue" },
		// ── Comentarios
		{ name: "jira_get_comments",           description: "Lista los comentarios de un issue" },
		{ name: "jira_add_comment",            description: "Añade un comentario a un issue" },
		{ name: "jira_update_comment",         description: "Actualiza el texto de un comentario existente" },
		{ name: "jira_delete_comment",         description: "Elimina un comentario de un issue" },
		// ── Transiciones
		{ name: "jira_get_transitions",        description: "Lista las transiciones disponibles para un issue" },
		{ name: "jira_transition_issue",       description: "Cambia el estado de un issue aplicando una transición" },
		// ── Worklogs
		{ name: "jira_get_worklogs",           description: "Lista los worklogs (tiempo registrado) de un issue" },
		{ name: "jira_add_worklog",            description: "Registra tiempo trabajado en un issue" },
		// ── Proyectos
		{ name: "jira_list_projects",          description: "Lista todos los proyectos accesibles" },
		{ name: "jira_get_project",            description: "Obtiene los detalles de un proyecto" },
		{ name: "jira_create_project",         description: "Crea un nuevo proyecto en Jira" },
		{ name: "jira_get_project_components", description: "Lista los componentes de un proyecto" },
		{ name: "jira_get_project_versions",   description: "Lista las versiones de un proyecto" },
		{ name: "jira_create_version",         description: "Crea una versión en un proyecto" },
		// ── Links
		{ name: "jira_get_link_types",         description: "Lista los tipos de link disponibles en Jira" },
		{ name: "jira_create_issue_link",      description: "Crea un link entre dos issues" },
		{ name: "jira_delete_issue_link",      description: "Elimina un link entre issues" },
		// ── Usuarios
		{ name: "jira_get_current_user",       description: "Obtiene la información del usuario autenticado" },
		{ name: "jira_get_user",               description: "Obtiene la información de un usuario por su account ID" },
		{ name: "jira_search_users",           description: "Busca usuarios en Atlassian por nombre o email" },
		{ name: "jira_get_assignable_users",   description: "Lista usuarios asignables en un proyecto o issue" },
		// ── Metadatos
		{ name: "jira_get_issue_types",        description: "Lista los tipos de issue disponibles" },
		{ name: "jira_get_priorities",         description: "Lista las prioridades disponibles en Jira" },
		{ name: "jira_get_statuses",           description: "Lista los estados disponibles" },
		{ name: "jira_get_fields",             description: "Lista todos los campos de Jira incluyendo custom fields" },
		{ name: "jira_get_project_metadata",   description: "Obtiene metadatos de creación de issues para un proyecto" },
		{ name: "jira_get_attachments",        description: "Lista los adjuntos de un issue" },
		// ── Boards y Sprints
		{ name: "jira_list_boards",            description: "Lista boards de Jira Agile" },
		{ name: "jira_get_board",              description: "Obtiene los detalles de un board específico" },
		{ name: "jira_list_sprints",           description: "Lista los sprints de un board" },
		{ name: "jira_get_sprint",             description: "Obtiene los detalles de un sprint" },
		{ name: "jira_get_sprint_issues",      description: "Lista los issues de un sprint" },
		{ name: "jira_create_sprint",          description: "Crea un nuevo sprint en un board" },
		{ name: "jira_update_sprint",          description: "Actualiza un sprint (nombre, estado, fechas, objetivo)" },
		{ name: "jira_move_issues_to_sprint",  description: "Mueve issues a un sprint" },
		{ name: "jira_get_board_backlog",      description: "Obtiene los issues del backlog de un board" },
		// ── Epics
		{ name: "jira_get_epic",               description: "Obtiene los detalles de un epic" },
		{ name: "jira_get_epic_issues",        description: "Lista los issues de un epic" },
		// ── Confluence – Spaces
		{ name: "confluence_list_spaces",      description: "Lista los espacios de Confluence" },
		{ name: "confluence_get_space",        description: "Obtiene los detalles de un espacio de Confluence" },
		{ name: "confluence_create_space",     description: "Crea un nuevo espacio en Confluence" },
		// ── Confluence – Páginas
		{ name: "confluence_get_page",             description: "Obtiene una página de Confluence por ID" },
		{ name: "confluence_get_page_by_title",    description: "Busca una página de Confluence por espacio y título" },
		{ name: "confluence_create_page",          description: "Crea una nueva página en Confluence" },
		{ name: "confluence_update_page",          description: "Actualiza el contenido de una página existente" },
		{ name: "confluence_delete_page",          description: "Elimina una página de Confluence (mueve a la papelera)" },
		{ name: "confluence_get_page_children",    description: "Lista las páginas hijas de una página" },
		{ name: "confluence_get_page_descendants", description: "Lista todos los descendientes de una página" },
		{ name: "confluence_get_page_history",     description: "Obtiene el historial de versiones de una página" },
		{ name: "confluence_move_page",            description: "Mueve una página dentro del árbol de Confluence" },
		// ── Confluence – Búsqueda
		{ name: "confluence_search",           description: "Busca contenido en Confluence usando CQL" },
		{ name: "confluence_search_text",      description: "Búsqueda de texto libre en Confluence" },
		// ── Confluence – Comentarios
		{ name: "confluence_get_comments",     description: "Lista los comentarios de una página de Confluence" },
		{ name: "confluence_add_comment",      description: "Añade un comentario a una página de Confluence" },
		{ name: "confluence_delete_comment",   description: "Elimina un comentario de Confluence" },
		// ── Confluence – Labels
		{ name: "confluence_get_labels",       description: "Lista las etiquetas de una página" },
		{ name: "confluence_add_labels",       description: "Añade etiquetas a una página" },
		{ name: "confluence_remove_label",     description: "Elimina una etiqueta de una página" },
		// ── Confluence – Restricciones
		{ name: "confluence_get_restrictions", description: "Obtiene las restricciones de acceso de una página" },
		{ name: "confluence_add_restriction",  description: "Añade una restricción de acceso a una página" },
		// ── Genérico
		{ name: "atlassian_request",           description: "Realiza una solicitud directa a la API de Atlassian (endpoints no cubiertos)" },
	],
	handler,
};
