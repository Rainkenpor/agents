import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./infrastructure/mcp/registerTools.js";

const INSTRUCTIONS = `
# agent-azuredevops

Servidor MCP para Azure DevOps organizado con arquitectura hexagonal.

## Reglas

- El PAT siempre debe viajar como input de la tool.
- No existe almacenamiento de PAT en el servidor.
- Usa las tools "use_case_*" para los casos de uso de negocio.
- Usa las tools "azdo_*" para operaciones puntuales de infraestructura.
- Usa "render_helm_values" como utilidad de soporte, no como caso de uso de flow.
`.trim();

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "agent-azuredevops", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server);
  return server;
}
