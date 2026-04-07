/**
 * Document Manager MCP — interfaz pública del módulo
 *
 * Exporta documentMcp: McpModule para el servidor centralizado.
 * El onStartup ejecuta el seed de la BD antes de que el servidor
 * empiece a aceptar requests.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpModule } from "../agent-server/types.ts";
import { db } from "./src/db/index.ts";
import { seed } from "./src/db/seed.ts";
import { registerTools } from "./tools.ts";

// ─── Handler HTTP (extraído de server.ts, sin chequeo de URL ni listen) ───────

async function handler(req: IncomingMessage, res: ServerResponse, parsedBody: unknown | Record<string, unknown>): Promise<void> {
	try {
		const mcpServer = new McpServer({ name: "document-manager", version: "1.0.0" });
		registerTools(mcpServer, db);
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => transport.close());
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res, parsedBody);
	} catch (err) {
		console.error("[document] error:", err);
		if (!res.headersSent) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		}
	}
}

// ─── Módulo exportado ─────────────────────────────────────────────────────────

export const documentMcp: McpModule = {
	slug: "document",
	displayName: "Document Manager",
	credentials: [],
	onStartup: async () => {
		await seed();
	},
	tools: [
		// ── Tipos de documento
		{ name: "list_document_types",   description: "List all document types, with optional filter by active status" },
		{ name: "get_document_type",     description: "Get a single document type by id or code" },
		{ name: "create_document_type",  description: "Create a new document type" },
		{ name: "update_document_type",  description: "Update an existing document type by id" },
		{ name: "delete_document_type",  description: "Soft-delete a document type by setting active=false" },
		// ── Templates
		{ name: "list_templates",        description: "List all templates with optional filters by type_id and/or active status" },
		{ name: "get_template",          description: "Get a single template by id or code, including all its sections" },
		{ name: "create_template",       description: "Create a new template for a document type" },
		{ name: "update_template",       description: "Update an existing template by id" },
		{ name: "delete_template",       description: "Soft-delete a template by setting active=false" },
		{ name: "add_template_section",    description: "Add a new section to a template" },
		{ name: "update_template_section", description: "Update an existing template section" },
		{ name: "delete_template_section", description: "Delete a template section by id" },
		// ── Documentos
		{ name: "list_documents",          description: "List all documents with optional filters by type_id and/or status" },
		{ name: "get_document",            description: "Get a single document by id or code, including all its sections" },
		{ name: "create_document",         description: "Create a new document from a template" },
		{ name: "update_document",         description: "Update an existing document's title or metadata" },
		{ name: "update_document_status",  description: "Update the status of a document (draft, completed, generated)" },
		{ name: "update_document_section", description: "Update the content of a document section" },
		{ name: "delete_document",         description: "Delete a document and all its sections" },
	],
	handler,
};
