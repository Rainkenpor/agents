// ─── Hooks del MCP de Rancher ─────────────────────────────────────────────────
//
// Se emiten tras mutaciones exitosas sobre deployments.

import z from "zod";
import type { HookDefinition } from "../types";

export const rancherHooks: HookDefinition[] = [
	{
		name: "deployment.restarted",
		description:
			"Se dispara después de reiniciar (redeploy) un deployment con rancher_restart_deployment",
		payloadSchema: {
			instance: z.string().describe("Instancia de Rancher (ej. 'qa')"),
			cluster: z.string().describe("ID del cluster (ej. 'local')"),
			namespace: z.string().describe("Namespace del deployment"),
			name: z.string().describe("Nombre del deployment"),
			restartedAt: z
				.string()
				.describe("Timestamp ISO-8601 del reinicio aplicado"),
		},
	},
	{
		name: "deployment.scaled",
		description:
			"Se dispara después de escalar un deployment con rancher_scale_deployment",
		payloadSchema: {
			instance: z.string().describe("Instancia de Rancher (ej. 'qa')"),
			cluster: z.string().describe("ID del cluster (ej. 'local')"),
			namespace: z.string().describe("Namespace del deployment"),
			name: z.string().describe("Nombre del deployment"),
			replicas: z.number().describe("Número de réplicas resultante"),
			previousReplicas: z
				.number()
				.optional()
				.describe("Número de réplicas previo al cambio"),
		},
	},
];
