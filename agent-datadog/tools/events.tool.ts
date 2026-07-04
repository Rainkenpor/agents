import z from "zod";
import { client, v1, v2 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

function makeConfig(apiKey: string, appKey: string) {
	return client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
}

export function eventsTools(apiKey: string, appKey: string): ToolDefinition[] {
	return [
		{
			name: "datadog_list_events",
			description: "Query Datadog events within a time range, with optional tag and priority filters.",
			inputSchema: {
				start: z.number().describe("Start of the time window as Unix timestamp (seconds)"),
				end: z.number().describe("End of the time window as Unix timestamp (seconds)"),
				priority: z.enum(["normal", "low"]).optional().describe("Filter by event priority"),
				sources: z.string().optional().describe("Comma-separated list of event sources to filter by (e.g. 'nagios,jenkins')"),
				tags: z.string().optional().describe("Comma-separated tag filters (e.g. 'env:prod,team:infra')"),
				excludeAggregate: z.boolean().optional().describe("Exclude aggregate events (default false)"),
			},
			handler: async ({
				start,
				end,
				priority,
				sources,
				tags,
				excludeAggregate,
			}: {
				start: number;
				end: number;
				priority?: string;
				sources?: string;
				tags?: string;
				excludeAggregate?: boolean;
			}) => {
				const api = new v1.EventsApi(makeConfig(apiKey, appKey));
				const result = await api.listEvents({
					start,
					end,
					priority: priority as v1.EventPriority | undefined,
					sources,
					tags,
					excludeAggregate,
				});
				return ok(result);
			},
		},
		{
			name: "datadog_search_events",
			description:
				"Search Datadog events using the v2 API with advanced filtering capabilities.",
			inputSchema: {
				query: z.string().optional().describe("Search query (e.g. 'source:github tags:env:prod')"),
				from: z.string().describe("Start of time range in ISO 8601 (e.g. '2024-01-01T00:00:00Z')"),
				to: z.string().describe("End of time range in ISO 8601 (e.g. '2024-01-01T01:00:00Z')"),
				limit: z.number().optional().describe("Maximum number of events to return (default 25)"),
				sort: z.enum(["timestamp", "-timestamp"]).optional().describe("Sort order (default: -timestamp = newest first)"),
			},
			handler: async ({
				query,
				from,
				to,
				limit,
				sort,
			}: {
				query?: string;
				from: string;
				to: string;
				limit?: number;
				sort?: string;
			}) => {
				const api = new v2.EventsApi(makeConfig(apiKey, appKey));
				const result = await api.listEvents({
					filterQuery: query,
					filterFrom: from,
					filterTo: to,
					pageLimit: limit ?? 25,
					sort: (sort ?? "-timestamp") as v2.EventsSort,
				});
				return ok(result);
			},
		},
	];
}
