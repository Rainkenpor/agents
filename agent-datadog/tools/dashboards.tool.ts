import z from "zod";
import { client, v1 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

function makeConfig(apiKey: string, appKey: string) {
	return client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
}

export function dashboardsTools(
	apiKey: string,
	appKey: string,
): ToolDefinition[] {
	return [
		{
			name: "datadog_list_dashboards",
			description:
				"List all Datadog dashboards, with optional filtering by name.",
			inputSchema: {
				filterShared: z
					.boolean()
					.optional()
					.describe("Filter to only shared dashboards"),
				filterDeleted: z
					.boolean()
					.optional()
					.describe("Filter to include deleted dashboards"),
				count: z
					.number()
					.optional()
					.describe("Maximum number of dashboards to return (default 100)"),
				start: z.number().optional().describe("Offset for pagination"),
			},
			handler: async ({
				filterShared,
				filterDeleted,
				count,
				start,
			}: {
				filterShared?: boolean;
				filterDeleted?: boolean;
				count?: number;
				start?: number;
			}) => {
				const api = new v1.DashboardsApi(makeConfig(apiKey, appKey));
				const result = await api.listDashboards({
					filterShared,
					filterDeleted,
					count: count ?? 100,
					start: start ?? 0,
				});
				return ok(result);
			},
		},
		{
			name: "datadog_get_dashboard",
			description:
				"Get the full definition of a specific Datadog dashboard by its ID.",
			inputSchema: {
				dashboardId: z
					.string()
					.describe("The ID of the dashboard (e.g. 'abc-def-ghi')"),
			},
			handler: async ({ dashboardId }: { dashboardId: string }) => {
				const api = new v1.DashboardsApi(makeConfig(apiKey, appKey));
				const result = await api.getDashboard({ dashboardId });
				return ok(result);
			},
		},
	];
}
