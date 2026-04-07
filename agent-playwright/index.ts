/**
 * Playwright (Puppeteer) MCP — interfaz pública del módulo
 *
 * Exporta playwrightMcp: McpModule para el servidor centralizado.
 * Args adicionales se inyectan vía headers x-arg-{campo}.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpModule } from "../agent-server/types.ts";
import { registerTools } from "./tools.ts";

// ─── Extrae headers x-arg-* como un Record de args ────────────────────────────

function extractHeaderArgs(req: IncomingMessage): Record<string, string> {
	const PREFIX = "x-arg-";
	const result: Record<string, string> = {};
	for (const [header, value] of Object.entries(req.headers)) {
		if (!header.startsWith(PREFIX)) continue;
		if (typeof value !== "string") continue;
		// x-arg-mcp-email → mcp_email
		const key = header.slice(PREFIX.length);
		result[key] = value;
	}
	return result;
}

// ─── Handler HTTP (extraído de server.ts, sin chequeo de URL ni listen) ───────

async function handler(req: IncomingMessage, res: ServerResponse, parsedBody: unknown | Record<string, unknown>): Promise<void> {
	let rpcMethod: string | undefined;
	if (parsedBody && typeof parsedBody === "object") {
		try {
			rpcMethod = (parsedBody as { method?: string }).method;
		} catch {
			// body no es JSON (p.ej. GET de SSE)
		}
	}

	const isDiscovery = rpcMethod === "tools/list" || rpcMethod === "initialize";
	const headerArgs = isDiscovery ? {} : extractHeaderArgs(req);

	try {
		const mcpServer = new McpServer({ name: "playwright-mcp", version: "1.0.0" });
		registerTools(mcpServer, headerArgs);
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => transport.close());
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res, parsedBody);
	} catch (err) {
		console.error("[playwright] error:", err);
		if (!res.headersSent) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		}
	}
}

// ─── Módulo exportado ─────────────────────────────────────────────────────────

export const playwrightMcp: McpModule = {
	slug: "playwright",
	displayName: "Playwright Automation",
	credentials: [],
	tools: [
		{ name: "playwright_init",          description: "Crea una nueva sesión de Puppeteer: lanza el navegador y devuelve un sessionId" },
		{ name: "playwright_execute",       description: "Ejecuta un script de automatización sobre una sesión activa" },
		{ name: "playwright_close",         description: "Cierra el navegador de una sesión activa de Puppeteer" },
		{ name: "playwright_list_sessions", description: "Lista todas las sesiones de Puppeteer registradas en el servidor" },
	],
	handler,
};
