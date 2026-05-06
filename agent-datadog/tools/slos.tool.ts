import z from "zod";
import { client, v1 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

function makeConfig(apiKey: string, appKey: string) {
	return client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
}

export function slosTools(apiKey: string, appKey: string): ToolDefinition[] {
	return [
		{
			name: "datadog_list_slos",
			description: "List Datadog Service Level Objectives (SLOs), with optional tag filtering.",
			inputSchema: {
				query: z.string().optional().describe("Search query to filter SLOs by name or description"),
				tagsQuery: z.string().optional().describe("Filter SLOs by tags (e.g. 'env:prod')"),
				limit: z.number().optional().describe("Maximum number of SLOs to return (default 100)"),
				offset: z.number().optional().describe("Offset for pagination"),
			},
			handler: async ({
				query,
				tagsQuery,
				limit,
				offset,
			}: {
				query?: string;
				tagsQuery?: string;
				limit?: number;
				offset?: number;
			}) => {
				const api = new v1.ServiceLevelObjectivesApi(makeConfig(apiKey, appKey));
				const result = await api.listSLOs({
					query,
					tagsQuery,
					limit: limit ?? 100,
					offset: offset ?? 0,
				});
				return ok(result);
			},
		},
		{
			name: "datadog_get_slo",
			description: "Get details of a specific Datadog SLO by its ID.",
			inputSchema: {
				sloId: z.string().describe("The ID of the SLO"),
				withConfiguredAlertIds: z.boolean().optional().describe("Include configured alert IDs in the response"),
			},
			handler: async ({
				sloId,
				withConfiguredAlertIds,
			}: {
				sloId: string;
				withConfiguredAlertIds?: boolean;
			}) => {
				const api = new v1.ServiceLevelObjectivesApi(makeConfig(apiKey, appKey));
				const result = await api.getSLO({ sloId, withConfiguredAlertIds });
				return ok(result);
			},
		},
		{
			name: "datadog_get_slo_history",
			description:
				"Get the historical status and error budget of a Datadog SLO for a time range.",
			inputSchema: {
				sloId: z.string().describe("The ID of the SLO"),
				fromTs: z.number().describe("Start of time range as Unix timestamp (seconds)"),
				toTs: z.number().describe("End of time range as Unix timestamp (seconds)"),
				target: z.number().optional().describe("Override the SLO target for history calculation (0-100)"),
			},
			handler: async ({
				sloId,
				fromTs,
				toTs,
				target,
			}: {
				sloId: string;
				fromTs: number;
				toTs: number;
				target?: number;
			}) => {
				const api = new v1.ServiceLevelObjectivesApi(makeConfig(apiKey, appKey));
				const result = await api.getSLOHistory({ sloId, fromTs, toTs, target });
				return ok(result);
			},
		},
	];
}
