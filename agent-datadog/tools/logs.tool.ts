import z from "zod";
import { client, v2 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

function makeConfig(apiKey: string, appKey: string) {
	return client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
}

export function logsTools(apiKey: string, appKey: string): ToolDefinition[] {
	return [
		{
			name: "datadog_search_logs",
			description:
				"Search Datadog logs using a filter query and time range. Returns matching log entries.",
			inputSchema: {
				query: z.string().describe("Log search query (e.g. 'service:api status:error')"),
				from: z.string().describe("Start of time range in ISO 8601 or relative format (e.g. 'now-1h', '2024-01-01T00:00:00Z')"),
				to: z.string().describe("End of time range in ISO 8601 or relative format (e.g. 'now', '2024-01-01T01:00:00Z')"),
				limit: z.number().optional().describe("Maximum number of log entries to return (default 50, max 1000)"),
				sort: z.enum(["timestamp", "-timestamp"]).optional().describe("Sort order: 'timestamp' (oldest first) or '-timestamp' (newest first, default)"),
				indexes: z.array(z.string()).optional().describe("List of log indexes to search (e.g. ['main', 'security'])"),
			},
			handler: async ({
				query,
				from,
				to,
				limit,
				sort,
				indexes,
			}: {
				query: string;
				from: string;
				to: string;
				limit?: number;
				sort?: string;
				indexes?: string[];
			}) => {
				const api = new v2.LogsApi(makeConfig(apiKey, appKey));
				const result = await api.listLogs({
					body: {
						filter: {
							query,
							from,
							to,
							indexes,
						},
						sort: (sort ?? "-timestamp") as v2.LogsSort,
						page: { limit: limit ?? 50 },
					},
				});
				return ok(result);
			},
		},
		{
			name: "datadog_aggregate_logs",
			description:
				"Aggregate Datadog logs to compute counts, averages, or other statistics grouped by fields.",
			inputSchema: {
				query: z.string().describe("Log filter query (e.g. 'service:api status:error')"),
				from: z.string().describe("Start of time range (e.g. 'now-1h' or ISO 8601)"),
				to: z.string().describe("End of time range (e.g. 'now' or ISO 8601)"),
				groupByField: z.string().optional().describe("Field to group results by (e.g. 'service', 'status', 'host')"),
				aggregationType: z.enum(["count", "cardinality", "sum", "avg", "median", "pc75", "pc90", "pc95", "pc98", "pc99", "max", "min"]).optional().describe("Aggregation function to apply (default: count)"),
				aggregationField: z.string().optional().describe("Numeric field to aggregate (required for sum, avg, median, percentile, max, min)"),
				limit: z.number().optional().describe("Maximum number of groups to return (default 10)"),
			},
			handler: async ({
				query,
				from,
				to,
				groupByField,
				aggregationType,
				aggregationField,
				limit,
			}: {
				query: string;
				from: string;
				to: string;
				groupByField?: string;
				aggregationType?: string;
				aggregationField?: string;
				limit?: number;
			}) => {
				const api = new v2.LogsApi(makeConfig(apiKey, appKey));
				const result = await api.aggregateLogs({
					body: {
						filter: { query, from, to },
						compute: [
							{
								aggregation: (aggregationType ?? "count") as v2.LogsAggregationFunction,
								...(aggregationField ? { metric: aggregationField } : {}),
							},
						],
						groupBy: groupByField
							? [{ facet: groupByField, limit: limit ?? 10 }]
							: undefined,
					},
				});
				return ok(result);
			},
		},
		{
			name: "datadog_send_logs",
			description: "Send log entries to Datadog. Useful for forwarding application logs.",
			inputSchema: {
				message: z.string().describe("Log message content"),
				service: z.string().optional().describe("Service name that generated the log"),
				hostname: z.string().optional().describe("Hostname where the log originated"),
				ddsource: z.string().optional().describe("Source of the log (e.g. 'nodejs', 'python')"),
				ddtags: z.string().optional().describe("Comma-separated Datadog tags (e.g. 'env:prod,version:1.2.3')"),
			},
			handler: async ({
				message,
				service,
				hostname,
				ddsource,
				ddtags,
			}: {
				message: string;
				service?: string;
				hostname?: string;
				ddsource?: string;
				ddtags?: string;
			}) => {
				const api = new v2.LogsApi(makeConfig(apiKey, appKey));
				const result = await api.submitLog({
					body: [
						{
							message,
							service,
							hostname,
							ddsource,
							ddtags,
						},
					],
				});
				return ok(result);
			},
		},
	];
}
