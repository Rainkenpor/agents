import z from "zod";
import { client, v1, v2 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

function makeConfig(apiKey: string, appKey: string) {
	return client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
}

export function metricsTools(apiKey: string, appKey: string): ToolDefinition[] {
	return [
		{
			name: "datadog_query_metrics",
			description:
				"Query Datadog time series metrics for a given time range and metric expression.",
			inputSchema: {
				query: z.string().describe("Metric query expression (e.g. 'avg:system.cpu.user{*}')"),
				from: z.number().describe("Start of the query window as Unix timestamp (seconds)"),
				to: z.number().describe("End of the query window as Unix timestamp (seconds)"),
			},
			handler: async ({ query, from, to }: { query: string; from: number; to: number }) => {
				const api = new v1.MetricsApi(makeConfig(apiKey, appKey));
				const result = await api.queryMetrics({ query, from, to });
				return ok(result);
			},
		},
		{
			name: "datadog_list_metrics",
			description: "List available Datadog metric names filtered by a search query.",
			inputSchema: {
				q: z.string().describe("Search query to filter metric names (e.g. 'system.cpu')"),
			},
			handler: async ({ q }: { q: string }) => {
				const api = new v1.MetricsApi(makeConfig(apiKey, appKey));
				const result = await api.listMetrics({ q });
				return ok(result);
			},
		},
		{
			name: "datadog_get_metric_metadata",
			description: "Get metadata for a specific Datadog metric (unit, description, type).",
			inputSchema: {
				metricName: z.string().describe("The full metric name (e.g. 'system.cpu.user')"),
			},
			handler: async ({ metricName }: { metricName: string }) => {
				const api = new v1.MetricsApi(makeConfig(apiKey, appKey));
				const result = await api.getMetricMetadata({ metricName });
				return ok(result);
			},
		},
		{
			name: "datadog_query_scalar_metrics",
			description:
				"Query scalar (aggregated point-in-time) metrics using the v2 API. Returns a single value per group.",
			inputSchema: {
				query: z.string().describe("Metric query with aggregation (e.g. 'avg:system.cpu.user{*}')"),
				from: z.number().describe("Start time as Unix timestamp in milliseconds"),
				to: z.number().describe("End time as Unix timestamp in milliseconds"),
			},
			handler: async ({ query, from, to }: { query: string; from: number; to: number }) => {
				const api = new v2.MetricsApi(makeConfig(apiKey, appKey));
				const result = await api.queryScalarData({
					body: {
						data: {
							type: "scalar_request",
							attributes: {
								from,
								to,
								queries: [
									{
										dataSource: "metrics",
										query,
										name: "result",
									} as v2.MetricsScalarQuery,
								],
							},
						},
					},
				});
				return ok(result);
			},
		},
	];
}
