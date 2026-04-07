/**
 * Atlassian MCP Server - Jira & Confluence
 * Transporte: Streamable HTTP
 * Auth:       headers mcp-token (API token) y mcp-email (email del usuario)
 * Env:        ATLASSIAN_BASE_URL (fallback), PORT (default 3000)
 *
 * Iniciar: bun run server.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AtlassianContext } from "./types.ts";
import { registerTools } from "./tools.ts";

// ─── Configuración ────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = (process.env.ATLASSIAN_BASE_URL ?? "").replace(
	/\/$/,
	"",
);
const PORT = Number(process.env.PORT ?? 3000);

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

	const jiraUrl = (p: string) =>
		`${baseUrl}/rest/api/3/${p.replace(/^\//, "")}`;
	const agileUrl = (p: string) =>
		`${baseUrl}/rest/agile/1.0/${p.replace(/^\//, "")}`;
	const cfluUrl = (p: string) =>
		`${baseUrl}/wiki/rest/api/${p.replace(/^\//, "")}`;
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
		const r = await fetch(u.toString(), {
			method: "DELETE",
			headers: authHeaders(),
		});
		if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
		return { status: "deleted" };
	}

	const s = new McpServer({ name: "atlassian-mcp", version: "1.0.0" });
	registerTools(s, {
		jiraUrl,
		agileUrl,
		cfluUrl,
		rawUrl,
		apiGet,
		apiPost,
		apiPut,
		apiDelete,
		authHeaders,
	});
	return s;
}

// ─── Servidor HTTP ─────────────────────────────────────────────────────────────

const httpServer = createServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		if (!req.url?.startsWith("/mcp")) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not Found. Use /mcp" }));
			return;
		}

		// Leer y parsear el body antes de validar auth para poder inspeccionar el método
		// JSON-RPC. El SDK espera un objeto ya parseado (parsedBody), no un Buffer raw.
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
				// body no es JSON (p.ej. GET de SSE); no hay método que verificar
			}
		}

		// tools/list e initialize solo necesitan descubrir la forma de las tools,
		// no realizan llamadas reales a la API de Atlassian.
		const isDiscovery =
			rpcMethod === "tools/list" || rpcMethod === "initialize";

		const token = req.headers["mcp-token"];
		const email = req.headers["mcp-email"];

		if (!isDiscovery) {
			if (!token || typeof token !== "string") {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({ error: "Missing required header: mcp-token" }),
				);
				return;
			}
			if (!email || typeof email !== "string") {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({ error: "Missing required header: mcp-email" }),
				);
				return;
			}
		}

		const rawBaseUrl = req.headers["mcp-base-url"];
		const baseUrl = (
			typeof rawBaseUrl === "string" ? rawBaseUrl : DEFAULT_BASE_URL
		).replace(/\/$/, "");
		if (!isDiscovery && !baseUrl) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					error:
						"Missing Atlassian base URL: set ATLASSIAN_BASE_URL or send mcp-base-url header",
				}),
			);
			return;
		}

		try {
			const mcpServer = buildServer({
				baseUrl: baseUrl || "https://placeholder.atlassian.net",
				email: typeof email === "string" ? email : "",
				token: typeof token === "string" ? token : "",
			});
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
	console.log(`✓ Atlassian MCP server -> http://localhost:${PORT}/mcp`);
	console.log(
		`  ATLASSIAN_BASE_URL: ${DEFAULT_BASE_URL || "(usar header mcp-base-url)"}`,
	);
	console.log("  Headers requeridos: mcp-token, mcp-email");
	console.log(
		"  Header opcional:    mcp-base-url (sobreescribe ATLASSIAN_BASE_URL)",
	);
});
