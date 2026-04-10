/**
 * Agent Azure DevOps MCP — interfaz pública del módulo
 *
 * Exporta agentAzureDevOpsMcp: McpModule para el servidor centralizado.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpModule } from "../../agent-server/types.ts";
import { initializeTools, registryTool } from "./tools.js";

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

async function handler(req: IncomingMessage, res: ServerResponse, body: unknown | Record<string, unknown>): Promise<void> {
  try {
    const mcpServer = new McpServer(
      { name: "agent-azuredevops", version: "0.1.0" },
      { instructions: INSTRUCTIONS },
    );
    initializeTools(mcpServer);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("[agent-azuredevops] error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  }
}

// ─── Módulo exportado ─────────────────────────────────────────────────────────

export const agentAzureDevOpsMcp: McpModule = {
  slug: "agent-azuredevops",
  displayName: "Agent Azure DevOps",
  credentials: [
    {
      key: "AZDO_ORGANIZATION",
      required: false,
      description: "Organizacion por defecto de Azure DevOps. Si falta, la tool usa grupodistelsa o el valor enviado por input.",
    },
  ],
  tools: registryTool.map((t) => ({ name: t.name, description: t.description })),
  handler,
};

export default agentAzureDevOpsMcp;
