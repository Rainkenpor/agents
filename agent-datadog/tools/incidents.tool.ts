import z from "zod";
import { client, v2 } from "@datadog/datadog-api-client";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { emit } from "../hooks";

function makeConfig(apiKey: string, appKey: string) {
	const config = client.createConfiguration({
		authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
	});
	config.unstableOperations["v2.listIncidents"] = true;
	config.unstableOperations["v2.createIncident"] = true;
	config.unstableOperations["v2.getIncident"] = true;
	config.unstableOperations["v2.updateIncident"] = true;
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
		{
			name: "datadog_create_incident",
			description: "Create a new Datadog incident.",
			inputSchema: {
				title: z.string().describe("Title of the incident"),
				customerImpacted: z.boolean().describe("Whether customers are impacted by this incident"),
				severity: z.enum(["SEV-1", "SEV-2", "SEV-3", "SEV-4", "SEV-5", "UNKNOWN"]).optional().describe("Incident severity level"),
				notificationHandles: z.array(z.string()).optional().describe("List of @handles to notify (e.g. ['@user@example.com'])"),
			},
			handler: async ({
				title,
				customerImpacted,
				severity,
				notificationHandles,
			}: {
				title: string;
				customerImpacted: boolean;
				severity?: string;
				notificationHandles?: string[];
			}) => {
				const api = new v2.IncidentsApi(makeConfig(apiKey, appKey));
				const result = await api.createIncident({
					body: {
						data: {
							type: "incidents",
							attributes: {
								title,
								customerImpacted,
								fields: severity ? { severity: { type: "dropdown", value: severity } } : undefined,
								notificationHandles: notificationHandles?.map((handle) => ({ handle })),
							},
						},
					},
				});
				await emit("incident.created", {
					id: result.data?.id,
					title,
					severity,
					customerImpacted,
				});
				return ok(result);
			},
		},
		{
			name: "datadog_update_incident",
			description: "Update an existing Datadog incident's status, severity, or other fields.",
			inputSchema: {
				incidentId: z.string().describe("The UUID of the incident to update"),
				title: z.string().optional().describe("New title for the incident"),
				status: z.enum(["active", "stable", "resolved"]).optional().describe("New status for the incident"),
				customerImpacted: z.boolean().optional().describe("Whether customers are impacted"),
				severity: z.enum(["SEV-1", "SEV-2", "SEV-3", "SEV-4", "SEV-5", "UNKNOWN"]).optional().describe("New severity level"),
			},
			handler: async ({
				incidentId,
				title,
				status,
				customerImpacted,
				severity,
			}: {
				incidentId: string;
				title?: string;
				status?: string;
				customerImpacted?: boolean;
				severity?: string;
			}) => {
				const api = new v2.IncidentsApi(makeConfig(apiKey, appKey));
				const result = await api.updateIncident({
					incidentId,
					body: {
						data: {
							id: incidentId,
							type: "incidents",
							attributes: {
								title,
								customerImpacted,
								fields: severity ? { severity: { type: "dropdown", value: severity } } : undefined,
							},
						},
					},
				});
				await emit("incident.updated", { id: incidentId, status, severity });
				return ok(result);
			},
		},
	];
}
