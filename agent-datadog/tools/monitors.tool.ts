import z from "zod";
import { client, v1 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

function makeConfig(apiKey: string, appKey: string) {
	return client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
}

export function monitorsTools(apiKey: string, appKey: string): ToolDefinition[] {
	return [
		{
			name: "datadog_list_monitors",
			description:
				"List Datadog monitors with optional filters by name, tags, or group states.",
			inputSchema: {
				name: z.string().optional().describe("Filter by monitor name (substring match)"),
				tags: z.string().optional().describe("Comma-separated list of tags to filter by (e.g. 'env:prod,team:infra')"),
				page: z.number().optional().describe("Page number for pagination (default 0)"),
				pageSize: z.number().optional().describe("Number of monitors per page (default 100, max 1000)"),
			},
			handler: async ({ name, tags, page, pageSize }: {
				name?: string;
				tags?: string;
				page?: number;
				pageSize?: number;
			}) => {
				const api = new v1.MonitorsApi(makeConfig(apiKey, appKey));
				const monitors = await api.listMonitors({
					name,
					tags,
					page: page ?? 0,
					pageSize: pageSize ?? 100,
				});
				return ok(monitors);
			},
		},
		{
			name: "datadog_get_monitor",
			description: "Get details of a specific Datadog monitor by its ID.",
			inputSchema: {
				monitorId: z.number().describe("The numeric ID of the monitor"),
			},
			handler: async ({ monitorId }: { monitorId: number }) => {
				const api = new v1.MonitorsApi(makeConfig(apiKey, appKey));
				const monitor = await api.getMonitor({ monitorId });
				return ok(monitor);
			},
		},
	];
}
