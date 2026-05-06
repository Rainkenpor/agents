import z from "zod";
import { client, v1 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { emit } from "../hooks";

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
		{
			name: "datadog_create_monitor",
			description:
				"Create a new Datadog monitor. Supports metric alert, service check, event alert, and more.",
			inputSchema: {
				type: z.string().describe(
					"Monitor type: 'metric alert', 'service check', 'event alert', 'query alert', 'log alert', 'composite', 'synthetics alert', 'process alert', 'trace-analytics alert', 'slo alert'",
				),
				query: z.string().describe("The monitor query expression"),
				name: z.string().describe("Name of the monitor"),
				message: z.string().optional().describe("Notification message including @mentions"),
				tags: z.array(z.string()).optional().describe("Tags to attach to the monitor (e.g. ['env:prod', 'team:infra'])"),
				priority: z.number().optional().describe("Monitor priority: 1 (highest) to 5 (lowest)"),
				thresholds: z.record(z.number()).optional().describe("Alert thresholds as key-value pairs (e.g. {critical: 90, warning: 80})"),
			},
			handler: async ({
				type,
				query,
				name,
				message,
				tags,
				priority,
				thresholds,
			}: {
				type: string;
				query: string;
				name: string;
				message?: string;
				tags?: string[];
				priority?: number;
				thresholds?: Record<string, number>;
			}) => {
				const api = new v1.MonitorsApi(makeConfig(apiKey, appKey));
				const monitor = await api.createMonitor({
					body: {
						type: type as v1.MonitorType,
						query,
						name,
						message,
						tags,
						priority,
						options: thresholds ? { thresholds } : undefined,
					},
				});
				return ok(monitor);
			},
		},
		{
			name: "datadog_update_monitor",
			description: "Update an existing Datadog monitor's configuration.",
			inputSchema: {
				monitorId: z.number().describe("The numeric ID of the monitor to update"),
				name: z.string().optional().describe("New name for the monitor"),
				message: z.string().optional().describe("New notification message"),
				tags: z.array(z.string()).optional().describe("New tags list (replaces existing)"),
				priority: z.number().optional().describe("New priority: 1 (highest) to 5 (lowest)"),
				query: z.string().optional().describe("New query expression"),
			},
			handler: async ({
				monitorId,
				name,
				message,
				tags,
				priority,
				query,
			}: {
				monitorId: number;
				name?: string;
				message?: string;
				tags?: string[];
				priority?: number;
				query?: string;
			}) => {
				const api = new v1.MonitorsApi(makeConfig(apiKey, appKey));
				const monitor = await api.updateMonitor({
					monitorId,
					body: { name, message, tags, priority, query },
				});
				return ok(monitor);
			},
		},
		{
			name: "datadog_delete_monitor",
			description: "Delete a Datadog monitor by its ID.",
			inputSchema: {
				monitorId: z.number().describe("The numeric ID of the monitor to delete"),
			},
			handler: async ({ monitorId }: { monitorId: number }) => {
				const api = new v1.MonitorsApi(makeConfig(apiKey, appKey));
				const result = await api.deleteMonitor({ monitorId });
				return ok(result);
			},
		},
		{
			name: "datadog_mute_monitor",
			description:
				"Mute a Datadog monitor to suppress notifications for a period of time.",
			inputSchema: {
				monitorId: z.number().describe("The numeric ID of the monitor to mute"),
				end: z.number().optional().describe("Unix timestamp when the mute expires (omit to mute indefinitely)"),
				scope: z.string().optional().describe("Scope to apply the mute to (e.g. 'env:prod')"),
			},
			handler: async ({ monitorId, end, scope }: { monitorId: number; end?: number; scope?: string }) => {
				const api = new v1.MonitorsApi(makeConfig(apiKey, appKey));
				// Use updateMonitor to set a downtime instead (muteMonitor API was deprecated)
				const silenced: { [key: string]: number } = {};
				const key = scope ?? "*";
				if (end !== undefined) silenced[key] = end;
				const result = await api.updateMonitor({
					monitorId,
					body: { options: { silenced } },
				});
				await emit("monitor.muted", { monitorId, end, scope });
				return ok(result);
			},
		},
		{
			name: "datadog_unmute_monitor",
			description: "Unmute a previously muted Datadog monitor by clearing its silenced scopes.",
			inputSchema: {
				monitorId: z.number().describe("The numeric ID of the monitor to unmute"),
			},
			handler: async ({ monitorId }: { monitorId: number }) => {
				const api = new v1.MonitorsApi(makeConfig(apiKey, appKey));
				const result = await api.updateMonitor({
					monitorId,
					body: { options: { silenced: {} } },
				});
				return ok(result);
			},
		},
	];
}
