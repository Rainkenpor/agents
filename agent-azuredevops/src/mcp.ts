import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initializeTools } from "./tools.js";

const INSTRUCTIONS = `
# agent-azuredevops

Servidor MCP para Azure DevOps organizado con arquitectura hexagonal.

## Reglas

- El PAT siempre debe viajar como input de la tool.
- No existe almacenamiento de PAT en el servidor.
- Usa las tools "use_case_*" para flujos completos de negocio con efectos en repos, ramas, PRs o pipelines.
- Usa las tools "azdo_*" para operaciones puntuales de infraestructura o verificaciones previas.
- Usa "render_helm_values" como utilidad de soporte, no como caso de uso de flow.
- Antes de crear recursos, valida el acceso con "azdo_validate_pat" si no conoces el alcance del PAT.
- "use_case_repo_pipeline_plus" solo soporta combinaciones ambiente/tecnologia con plantilla CI/CD real.
`.trim();

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "agent-azuredevops", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  initializeTools(server);
  return server;
}
