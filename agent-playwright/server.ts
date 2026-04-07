/**
 * Puppeteer MCP Server
 * Transporte: Streamable HTTP
 * Puerto:     PORT (default 3000)
 *
 * Headers opcionales para inyectar args sin enviarlos en el body:
 *   x-arg-{campo}  →  arg key (los guiones se convierten a guiones bajos)
 *   Ejemplos:
 *     x-arg-url           → url
 *     x-arg-mcp-email     → mcp_email
 *     x-arg-mcp-password  → mcp_password
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
import { registerTools } from "./tools.ts";

const PORT = Number(process.env.PORT ?? 3000);

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

// ─── Servidor HTTP ─────────────────────────────────────────────────────────────
// McpServer se crea por request para que cada llamada reciba su propio set de
// headerArgs. El store de sesiones de Puppeteer vive en types.ts (módulo global)

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
				// body no es JSON (p.ej. GET de SSE)
			}
		}

		// tools/list e initialize no necesitan headerArgs
		const isDiscovery =
			rpcMethod === "tools/list" || rpcMethod === "initialize";

		const headerArgs = isDiscovery ? {} : extractHeaderArgs(req);

		try {
			const mcpServer = new McpServer({
				name: "playwright-mcp",
				version: "1.0.0",
			});
			registerTools(mcpServer, headerArgs);

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
	console.log(`✓ Playwright MCP server -> http://localhost:${PORT}/mcp`);
	console.log("  Tools disponibles:");
	console.log("    playwright_login          - Crea una sesión de browser");
	console.log(
		"    playwright_execute        - Ejecuta un script de automatización",
	);
	console.log(
		"    playwright_logout         - Cierra el navegador de una sesión",
	);
	console.log(
		"    playwright_list_sessions  - Lista sesiones y su última actualización",
	);
	console.log("");
	console.log("  Args via headers (x-arg-{campo}):");
	console.log("    x-arg-url           → url");
	console.log("    x-arg-mcp-email     → mcp-email");
	console.log("    x-arg-mcp-password  → mcp-password");
});
