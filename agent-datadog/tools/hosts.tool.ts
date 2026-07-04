import z from "zod";
import { client, v1 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

function makeConfig(apiKey: string, appKey: string) {
	return client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
}

export function hostsTools(apiKey: string, appKey: string): ToolDefinition[] {
	return [
		{
			name: "datadog_list_hosts",
			description:
				"List active Datadog hosts, with optional filtering by name, tags, or source.",
			inputSchema: {
				filter: z.string().optional().describe("Filter string to search hosts by name or tags (e.g. 'env:prod')"),
				count: z.number().optional().describe("Maximum number of hosts to return (default 100)"),
				start: z.number().optional().describe("Offset for pagination"),
				from: z.number().optional().describe("Unix timestamp — only include hosts active since this time"),
				includeMutedHostsData: z.boolean().optional().describe("Include muted hosts and mute expiry timestamps (default false)"),
				includeHostsMetadata: z.boolean().optional().describe("Include host metadata such as OS, CPU, and memory info"),
			},
			handler: async ({
				filter,
				count,
				start,
				from,
				includeMutedHostsData,
				includeHostsMetadata,
			}: {
				filter?: string;
				count?: number;
				start?: number;
				from?: number;
				includeMutedHostsData?: boolean;
				includeHostsMetadata?: boolean;
			}) => {
				const api = new v1.HostsApi(makeConfig(apiKey, appKey));
				const result = await api.listHosts({
					filter,
					count: count ?? 100,
					start: start ?? 0,
					from,
					includeMutedHostsData,
					includeHostsMetadata,
				});
				return ok(result);
			},
		},
		{
			name: "datadog_get_host_totals",
			description:
				"Get the total count of active and up hosts in your Datadog infrastructure.",
			inputSchema: {
				from: z.number().optional().describe("Unix timestamp — count hosts active since this time"),
			},
			handler: async ({ from }: { from?: number }) => {
				const api = new v1.HostsApi(makeConfig(apiKey, appKey));
				const result = await api.getHostTotals({ from });
				return ok(result);
			},
		},
	];
}
