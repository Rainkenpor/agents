// ─── Tool Registry ────────────────────────────────────────────────────────────
//
// Registro central de todas las tools MCP (Registry Pattern).
//
// CÓMO AGREGAR UN NUEVO GRUPO DE TOOLS:
//   1. Crear `tools/mi-dominio.tool.ts` y exportar un `ToolDefinition[]`.
//   2. Importar ese array aquí y hacer spread en `registryTool`.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition } from "./types";
import { logger } from "./util/logger";
import { teamsTools } from "./tools/teams.tool";

const RESPONSE_PREVIEW_LENGTH = 200;

// ─── Agregar nuevos arrays de tools aquí ──────────────────────────────────────
export const registryTool: ToolDefinition[] = [...teamsTools];

function wrapHandler(
	name: string,
	handler: ToolDefinition["handler"],
): ToolDefinition["handler"] {
	return async (args) => {
		logger.info(`[tool] → ${name}(${JSON.stringify(args)})`);
		const result = await handler(args);
		const preview = JSON.stringify(result);
		const suffix = preview.length > RESPONSE_PREVIEW_LENGTH ? "…" : "";
		logger.info(
			`[tool] ← ${preview.slice(0, RESPONSE_PREVIEW_LENGTH)}${suffix}`,
		);
		return result;
	};
}

/**
 * Registra cada tool del registry en la instancia de McpServer dada.
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
