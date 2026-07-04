import z from "zod";
import { client, v2 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

function makeConfig(apiKey: string, appKey: string) {
	return client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
}

export function servicesTools(apiKey: string, appKey: string): ToolDefinition[] {
	return [
		{
			name: "datadog_list_services",
			description:
				"List APM services registered in the Datadog Service Catalog (Software Catalog). Returns service definitions with their metadata (owner, team, tier, links).",
			inputSchema: {
				pageSize: z
					.number()
					.optional()
					.describe("Number of services per page (max 100, default 20)"),
				pageNumber: z
					.number()
					.optional()
					.describe("Page number to return (default 0)"),
				schemaVersion: z
					.enum(["v1", "v2", "v2.1", "v2.2"])
					.optional()
					.describe("Service definition schema version to return (default v2.2)"),
			},
			handler: async ({
				pageSize,
				pageNumber,
				schemaVersion,
			}: {
				pageSize?: number;
				pageNumber?: number;
				schemaVersion?: string;
			}) => {
				const api = new v2.ServiceDefinitionApi(makeConfig(apiKey, appKey));
				const result = await api.listServiceDefinitions({
					pageSize: pageSize ?? 20,
					pageNumber: pageNumber ?? 0,
					schemaVersion: schemaVersion as
						| v2.ServiceDefinitionSchemaVersions
						| undefined,
				});
				return ok(result);
			},
		},
		{
			name: "datadog_get_service_definition",
			description:
				"Get the full service definition for a specific APM service by its name, as registered in the Datadog Service Catalog.",
			inputSchema: {
				serviceName: z
					.string()
					.describe("The name of the service (e.g. 'apps/callcenter')"),
				schemaVersion: z
					.enum(["v1", "v2", "v2.1", "v2.2"])
					.optional()
					.describe("Service definition schema version to return (default v2.2)"),
			},
			handler: async ({
				serviceName,
				schemaVersion,
			}: {
				serviceName: string;
				schemaVersion?: string;
			}) => {
				const api = new v2.ServiceDefinitionApi(makeConfig(apiKey, appKey));
				const result = await api.getServiceDefinition({
					serviceName,
					schemaVersion: schemaVersion as
						| v2.ServiceDefinitionSchemaVersions
						| undefined,
				});
				return ok(result);
			},
		},
		{
			name: "datadog_list_service_metrics",
			description:
				"Get APM traffic metrics (request count, error count, latency) aggregated per service over a time range, by aggregating spans grouped by service. Useful to reproduce the APM 'Services' list view (requests, error rate, latency).",
			inputSchema: {
				query: z
					.string()
					.optional()
					.describe(
						"Span filter query (e.g. 'env:prod'). Combine with the aggregation to narrow the services returned. Defaults to '*'.",
					),
				from: z
					.string()
					.describe(
						"Start of time range. Supports ISO 8601, date math (e.g. 'now-1h'), or epoch ms.",
					),
				to: z
					.string()
					.describe(
						"End of time range. Supports ISO 8601, date math (e.g. 'now'), or epoch ms.",
					),
				limit: z
					.number()
					.optional()
					.describe("Maximum number of services to return (default 50)"),
			},
			handler: async ({
				query,
				from,
				to,
				limit,
			}: {
				query?: string;
				from: string;
				to: string;
				limit?: number;
			}) => {
				const api = new v2.SpansApi(makeConfig(apiKey, appKey));
				const result = await api.aggregateSpans({
					body: {
						data: {
							type: "aggregate_request",
							attributes: {
								filter: { query: query ?? "*", from, to },
								compute: [{ aggregation: "count", type: "total" }],
								groupBy: [
									{ facet: "service", limit: limit ?? 50, total: false },
								],
							},
						},
					},
				});
				return ok(result);
			},
		},
		{
			name: "datadog_list_endpoints",
			description:
				"List APM endpoints (span resources) for a given service over a time range, aggregating spans grouped by resource name. Reproduces the APM 'Endpoints' view (e.g. 'GET /callcenter/registro_contacto.aspx') with request counts per endpoint.",
			inputSchema: {
				service: z
					.string()
					.optional()
					.describe(
						"Service name to scope endpoints to (e.g. 'apps/callcenter'). If omitted, endpoints across all services are returned.",
					),
				query: z
					.string()
					.optional()
					.describe(
						"Additional span filter query merged with the service filter (e.g. 'env:prod status:error').",
					),
				from: z
					.string()
					.describe(
						"Start of time range. Supports ISO 8601, date math (e.g. 'now-1h'), or epoch ms.",
					),
				to: z
					.string()
					.describe(
						"End of time range. Supports ISO 8601, date math (e.g. 'now'), or epoch ms.",
					),
				limit: z
					.number()
					.optional()
					.describe("Maximum number of endpoints to return (default 100)"),
			},
			handler: async ({
				service,
				query,
				from,
				to,
				limit,
			}: {
				service?: string;
				query?: string;
				from: string;
				to: string;
				limit?: number;
			}) => {
				const api = new v2.SpansApi(makeConfig(apiKey, appKey));
				const parts = [
					service ? `service:${service}` : undefined,
					query,
				].filter(Boolean);
				const filterQuery = parts.length ? parts.join(" ") : "*";
				const result = await api.aggregateSpans({
					body: {
						data: {
							type: "aggregate_request",
							attributes: {
								filter: { query: filterQuery, from, to },
								compute: [{ aggregation: "count", type: "total" }],
								groupBy: [
									{
										facet: "resource_name",
										limit: limit ?? 100,
										total: false,
									},
								],
							},
						},
					},
				});
				return ok(result);
			},
		},
		{
			name: "datadog_search_spans",
			description:
				"Search individual APM spans (traces) matching a query over a time range. Useful to inspect requests to a specific endpoint or service, including latency and errors.",
			inputSchema: {
				query: z
					.string()
					.describe(
						"Span search query following the span syntax (e.g. 'service:apps/callcenter resource_name:\"GET /callcenter/registro_contacto.aspx\"').",
					),
				from: z
					.string()
					.describe(
						"Start of time range. Supports ISO 8601, date math (e.g. 'now-1h'), or epoch ms.",
					),
				to: z
					.string()
					.describe(
						"End of time range. Supports ISO 8601, date math (e.g. 'now'), or epoch ms.",
					),
				limit: z
					.number()
					.optional()
					.describe("Maximum number of spans to return (default 25, max 1000)"),
				sort: z
					.enum(["timestamp", "-timestamp"])
					.optional()
					.describe(
						"Sort order: 'timestamp' (oldest first) or '-timestamp' (newest first, default)",
					),
			},
			handler: async ({
				query,
				from,
				to,
				limit,
				sort,
			}: {
				query: string;
				from: string;
				to: string;
				limit?: number;
				sort?: string;
			}) => {
				const api = new v2.SpansApi(makeConfig(apiKey, appKey));
				const result = await api.listSpansGet({
					filterQuery: query,
					filterFrom: from,
					filterTo: to,
					pageLimit: limit ?? 25,
					sort: (sort ?? "-timestamp") as v2.SpansSort,
				});
				return ok(result);
			},
		},
	];
}
