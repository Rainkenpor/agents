import type { McpModule } from "./types.ts";
import { jiraMcp } from "../agent-jira/index.ts";
import { documentMcp } from "../agent-document/index.ts";
import { playwrightMcp } from "../agent-playwright/index.ts";
import { azureDevopsMcp } from "../agent-azuredevops/index.ts";
import { eventSourceMcp } from "../agent-event-source/index.ts";
import { unitTestMCP } from "../agent-unitTest/index.ts";
import { datadogMcp } from "./../agent-datadog/index";
import { PencilMcp } from "../agent-pencil/index.ts";
import { teamsMcp } from "../agent-teams/index.ts";
import { elasticMcp } from "../agent-elastic/index.ts";
import { gitMcp } from "../agent-git/index.ts";
import { sonarMcp } from "../agent-sonar/index.ts";
import { rancherMcp } from "../agent-rancher/index.ts";

/**
 * Lista de todos los MCPs registrados en el servidor central.
 *
 * Para agregar un nuevo MCP:
 *   1. Crear su index.ts exportando un McpModule
 *   2. Importarlo aquí y agregarlo al array
 */
export const mcpModules: McpModule[] = [
	jiraMcp,
	documentMcp,
	playwrightMcp,
	azureDevopsMcp,
	eventSourceMcp,
	unitTestMCP,
	datadogMcp,
	PencilMcp,
	teamsMcp,
	elasticMcp,
	gitMcp,
	sonarMcp,
	rancherMcp,
];
