/**
 * Agent Azure DevOps MCP — interfaz pública del módulo
 *
 * Exporta agentAzureDevOpsMcp: McpModule para el servidor centralizado.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpModule } from "../agent-server/types.ts";
import { initializeTools } from "./src/tools.ts";

const INSTRUCTIONS = `
# agent-azuredevops

Servidor MCP para Azure DevOps organizado con arquitectura hexagonal.

## Reglas

- El PAT siempre debe viajar como input de la tool.
- No existe almacenamiento de PAT en el servidor.
- Usa las tools "use_case_*" para flujos completos de negocio con efectos en repos, ramas, PRs o pipelines.
- Usa las tools "azdo_*" para operaciones puntuales de infraestructura o verificaciones previas.
- Usa "use_case_create_selfservice_repository" para crear el repositorio self-service con valores Helm.
- Antes de crear recursos, valida el acceso con "azdo_validate_pat" si no conoces el alcance del PAT.
- "use_case_repo_pipeline_plus" solo soporta combinaciones ambiente/tecnologia con plantilla CI/CD real.
`.trim();

// ─── Handler HTTP (sin chequeo de URL ni listen) ──────────────────────────────

async function handler(
	req: IncomingMessage,
	res: ServerResponse,
	parsedBody: unknown | Record<string, unknown>,
): Promise<void> {
	try {
		let rpcMethod: string | undefined;
		if (parsedBody && typeof parsedBody === "object") {
			try {
				rpcMethod = (parsedBody as { method?: string }).method;
			} catch {
				// body no es JSON (p.ej. GET de SSE)
			}
		}

		const patHeader = req.headers["mcp-pat"];
		const pat = Array.isArray(patHeader) ? patHeader[0] : patHeader;
		const isDiscovery =
			rpcMethod === "tools/list" || rpcMethod === "initialize";

		if (!pat && !isDiscovery) {
			throw new Error(
				"Credencial invalida: Personal Access Token (PAT) no definido",
			);
		}
		const mcpServer = new McpServer(
			{ name: "agent-azuredevops", version: "0.1.0" },
			{ instructions: INSTRUCTIONS },
		);
		initializeTools(mcpServer, pat ?? "");
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});
		res.on("close", () => transport.close());
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res, parsedBody);
	} catch (err) {
		console.error("[agent-azuredevops] error:", err);
		if (!res.headersSent) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		}
	}
}

// ─── Módulo exportado ─────────────────────────────────────────────────────────

export const azureDevopsMcp: McpModule = {
	slug: "azuredevops",
	displayName: "Agent Azure DevOps",
	credentials: [
		{
			key: "AZDO_ORGANIZATION",
			required: false,
			description:
				"Organizacion por defecto de Azure DevOps. Si falta, la tool usa grupodistelsa o el valor enviado por input.",
		},
	],
	tools: [
		// ── Validación y repositorios
		//{ name: "azdo_validate_pat",              description: "Valida credenciales antes de ejecutar cambios en Azure DevOps." },
		//{ name: "azdo_check_repository",          description: "Consulta si un repositorio existe y devuelve su metadata principal." },
		//{ name: "azdo_create_repository",         description: "Crea un repositorio si no existe y lo deja listo para pushes." },
		//// ── Helm
		//{ name: "use_case_create_selfservice_repository", description: "Crea el repositorio self-service-devops con valores Helm para las ramas estandar." },
		//// ── Pipelines
		//{ name: "azdo_register_pipeline",         description: "Registra en Azure DevOps un YAML que ya existe en el repo." },
		// ── Casos de uso
		{
			name: "use_case_create_selfservice_repository",
			description:
				"Crea el repositorio self-service-devops con valores Helm para las ramas estandar.",
		},
		{
			name: "use_case_repo_pipeline_trigger",
			description:
				"Registra los pipelines estandar cuando los YAML ya existen en el repositorio.",
		},
		{
			name: "use_case_repo_pipeline_plus",
			description:
				"Genera un YAML CI/CD, lo sube a una rama de trabajo y crea PR hacia la rama objetivo.",
		},
	],
	handler,
};

export default azureDevopsMcp;
