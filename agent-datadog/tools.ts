import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition } from "./types";
import { logger } from "./util/logger";
import { monitorsTools } from "./tools/monitors.tool";
import { incidentsTools } from "./tools/incidents.tool";
import { metricsTools } from "./tools/metrics.tool";
import { logsTools } from "./tools/logs.tool";
import { dashboardsTools } from "./tools/dashboards.tool";
import { eventsTools } from "./tools/events.tool";
import { slosTools } from "./tools/slos.tool";
import { hostsTools } from "./tools/hosts.tool";

const RESPONSE_PREVIEW_LENGTH = 200;

function buildRegistry(apiKey: string, appKey: string): ToolDefinition[] {
	return [
		...monitorsTools(apiKey, appKey),
		...incidentsTools(apiKey, appKey),
		...metricsTools(apiKey, appKey),
		...logsTools(apiKey, appKey),
		...dashboardsTools(apiKey, appKey),
		...eventsTools(apiKey, appKey),
		...slosTools(apiKey, appKey),
		...hostsTools(apiKey, appKey),
	];
}

// Static registry for metadata (no credentials needed)
export const registryTool: ToolDefinition[] = buildRegistry("", "");

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

export function initializeTools(s: McpServer, apiKey: string, appKey: string): void {
	const tools = buildRegistry(apiKey, appKey);
	for (const tool of tools) {
		s.registerTool(
			tool.name,
			{ description: tool.description, inputSchema: tool.inputSchema },
			wrapHandler(tool.name, tool.handler),
		);
	}
}
