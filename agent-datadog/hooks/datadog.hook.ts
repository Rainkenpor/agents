import z from "zod";
import type { HookDefinition } from "../types";

export const datadogHooks: HookDefinition[] = [
	{
		name: "monitor.muted",
		description: "Fired after a Datadog monitor is muted via datadog_mute_monitor",
		payloadSchema: {
			monitorId: z.number().describe("ID of the muted monitor"),
			end: z.number().optional().describe("Unix timestamp when the mute expires"),
			scope: z.string().optional().describe("Scope the mute was applied to"),
		},
	},
	{
		name: "incident.created",
		description: "Fired after a new Datadog incident is created via datadog_create_incident",
		payloadSchema: {
			id: z.string().optional().describe("UUID of the created incident"),
			title: z.string().describe("Title of the incident"),
			severity: z.string().optional().describe("Severity level of the incident"),
			customerImpacted: z.boolean().describe("Whether customers are impacted"),
		},
	},
	{
		name: "incident.updated",
		description: "Fired after a Datadog incident is updated via datadog_update_incident",
		payloadSchema: {
			id: z.string().describe("UUID of the updated incident"),
			status: z.string().optional().describe("New status of the incident"),
			severity: z.string().optional().describe("New severity level"),
		},
	},
];
