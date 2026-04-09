// ─── Tool Registry ────────────────────────────────────────────────────────────
//
// Registro central de todas las herramientas MCP (Registry Pattern).
//
// COMO AGREGAR UN NUEVO GRUPO DE TOOLS:
//   1. Crear `tools/mi-dominio.tool.ts` y exportar un `ToolDefinition[]`.
//   2. Importar ese array aqui y hacer spread en `registryTool`.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition } from "./types.js";
import { logger } from "./util/logger.js";
import { azureDevOpsTools } from "./tools/azuredevops.tool.js";

const RESPONSE_PREVIEW_LENGTH = 200;

// ─── Agregar nuevos arrays de tools aqui ─────────────────────────────────────
export const registryTool: ToolDefinition[] = [...azureDevOpsTools];

function wrapHandler(
  name: string,
  handler: ToolDefinition["handler"],
): ToolDefinition["handler"] {
  return async (args) => {
    logger.info(`[tool] → ${name}(${JSON.stringify(args)})`);
    const result = await handler(args);
    const preview = JSON.stringify(result);
    const suffix = preview.length > RESPONSE_PREVIEW_LENGTH ? "…" : "";
    logger.info(`[tool] ← ${preview.slice(0, RESPONSE_PREVIEW_LENGTH)}${suffix}`);
    return result;
  };
}

/**
 * Registra todas las tools del registry en el McpServer dado
 * y aplica logging centralizado via wrapHandler.
 */
export function initializeTools(s: McpServer): void {
  for (const tool of registryTool) {
    s.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      wrapHandler(tool.name, tool.handler),
    );
  }
}
