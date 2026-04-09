import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initializeTools } from "./tools.js";

const INSTRUCTIONS = `
# agent-azuredevops

Servidor MCP para Azure DevOps organizado con arquitectura hexagonal.

## Reglas

- El PAT siempre debe viajar como input de la tool.
- No existe almacenamiento de PAT en el servidor.
- Solo las tools "use_case_*" estan disponibles. Representan flujos completos de negocio con efectos en repos, ramas, PRs o pipelines.
- Las operaciones de infraestructura (validacion de PAT, creacion de repos, registro de pipelines) son internas y se ejecutan dentro de cada use-case automaticamente.
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
