/**
 * MCP Template — interfaz pública del módulo
 *
 * Exporta templateMcp: McpModule para el servidor centralizado.
 * Sirve de referencia/starter kit para crear nuevos MCPs.
 *
 * [INSTRUCCIONES]
 * 1. Copiar esta carpeta completa con un nuevo nombre (ej. agent-miodominio)
 * 2. Actualizar slug, displayName, tools y credentials
 * 3. Implementar el handler con la lógica del server.ts de tu dominio
 * 4. Registrar en agent-server/registry.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpModule } from "../agent-server/types.ts";
import { initializeTools, registryTool } from "./tools.ts";
import { envs } from "./util/envs.ts";

const DEFAULT_BASE_URL = (envs.BASE_URL ?? "").replace(/\/$/, "");

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

	// tools/list e initialize no necesitan auth real
	const _isDiscovery = rpcMethod === "tools/list" || rpcMethod === "initialize";

	try {
		const mcpServer = new McpServer({ name: "mcp-template", version: "1.0.0" });
		initializeTools(mcpServer);
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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

// ─── Módulo exportado ─────────────────────────────────────────────────────────

export const templateMcp: McpModule = {
	slug: "template",
	displayName: "MCP Template",
	credentials: [
		{
			key: "SERVER_BASE_URL",
			required: false,
			description: `Base URL del servicio (default: ${DEFAULT_BASE_URL})`,
		},
	],
	// Genera la lista de tools dinámicamente desde el registry
	tools: registryTool.map((t) => ({ name: t.name, description: t.description })),
	handler,
};
