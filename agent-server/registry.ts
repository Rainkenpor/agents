import type { McpModule } from "./types.ts";
import { jiraMcp } from "../agent-jira/index.ts";
import { documentMcp } from "../agent-document/index.ts";
import { playwrightMcp } from "../agent-playwright/index.ts";

/**
 * Lista de todos los MCPs registrados en el servidor central.
 *
 * Para agregar un nuevo MCP:
 *   1. Crear su index.ts exportando un McpModule
 *   2. Importarlo aquí y agregarlo al array
 */
export const mcpModules: McpModule[] = [jiraMcp, documentMcp, playwrightMcp];
