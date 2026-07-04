import z from "zod";
import { client, v2 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

function makeConfig(apiKey: string, appKey: string) {
	const config = client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
	config.unstableOperations["v2.listIncidents"] = true;
	config.unstableOperations["v2.getIncident"] = true;
	return config;
}

export function incidentsTools(apiKey: string, appKey: string): ToolDefinition[] {
	return [
		{
			name: "datadog_list_incidents",
			description: "List Datadog incidents with optional filters.",
			inputSchema: {
				pageSize: z.number().optional().describe("Maximum number of incidents to return (default 10)"),
				pageOffset: z.number().optional().describe("Offset for pagination"),
				include: z.string().optional().describe("Comma-separated related resources to include: 'users', 'attachments'"),
			},
			handler: async ({
				pageSize,
				pageOffset,
				include,
			}: {
				pageSize?: number;
				pageOffset?: number;
				include?: string;
			}) => {
				const api = new v2.IncidentsApi(makeConfig(apiKey, appKey));
				const result = await api.listIncidents({
					pageSize: pageSize ?? 10,
					pageOffset: pageOffset ?? 0,
					include: include as v2.IncidentRelatedObject[] | undefined,
				});
				return ok(result);
			},
		},
		{
			name: "datadog_get_incident",
			description: "Get details of a specific Datadog incident by its ID.",
			inputSchema: {
				incidentId: z.string().describe("The UUID of the incident"),
				include: z.string().optional().describe("Comma-separated related resources to include: 'users', 'attachments'"),
			},
			handler: async ({ incidentId, include }: { incidentId: string; include?: string }) => {
				const api = new v2.IncidentsApi(makeConfig(apiKey, appKey));
				const result = await api.getIncident({
					incidentId,
					include: include as v2.IncidentRelatedObject[] | undefined,
				});
				return ok(result);
			},
		},
	];
}
