// ─── Tools del MCP de Rancher ─────────────────────────────────────────────────
//
// Todas las tools reciben `instance` (qa, dev, …) y, donde aplica, `cluster`
// (default "local"). Lectura: clusters, namespaces, deployments, pods y logs.
// Mutaciones: restart (redeploy) y scale de deployments — emiten hooks.

import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { emit } from "../hooks";
import {
	rancherGet,
	rancherPut,
	normanGet,
	getPodLogs,
} from "../util/rancher";

const instance = z
	.string()
	.describe("Instancia de Rancher a usar (ej. 'qa' o 'dev')");

const cluster = z
	.string()
	.optional()
	.describe("ID del cluster dentro de la instancia (default: 'local')");

/** Tipo mínimo de un deployment de la Steve API que mutamos */
interface SteveDeployment {
	spec?: {
		replicas?: number;
		template?: { metadata?: { annotations?: Record<string, string> } };
	};
	[key: string]: unknown;
}

export const rancherTools: ToolDefinition[] = [
	// ─── Lectura ────────────────────────────────────────────────────────────────
	{
		name: "rancher_list_clusters",
		description:
			"Lista los clusters disponibles en una instancia de Rancher (Norman API /v3/clusters).",
		inputSchema: { instance },
		handler: async ({ instance }: { instance: string }) => {
			const data = await normanGet(instance, "clusters");
			return ok(data);
		},
	},
	{
		name: "rancher_list_namespaces",
		description:
			"Lista los namespaces de un cluster en una instancia de Rancher.",
		inputSchema: { instance, cluster },
		handler: async ({
			instance,
			cluster,
		}: { instance: string; cluster?: string }) => {
			const data = await rancherGet(instance, cluster ?? "local", "namespaces");
			return ok(data);
		},
	},
	{
		name: "rancher_list_deployments",
		description:
			"Lista los deployments de un cluster. Opcionalmente filtra por namespace.",
		inputSchema: {
			instance,
			cluster,
			namespace: z
				.string()
				.optional()
				.describe("Namespace para filtrar (ej. 'psi'). Si se omite, lista todos."),
		},
		handler: async ({
			instance,
			cluster,
			namespace,
		}: { instance: string; cluster?: string; namespace?: string }) => {
			const data = await rancherGet(
				instance,
				cluster ?? "local",
				"apps.deployments",
				namespace ? { "filter[metadata.namespace]": namespace } : undefined,
			);
			return ok(data);
		},
	},
	{
		name: "rancher_get_deployment",
		description:
			"Obtiene el detalle de un deployment (estado, réplicas, imagen, anotaciones).",
		inputSchema: {
			instance,
			cluster,
			namespace: z.string().describe("Namespace del deployment (ej. 'psi')"),
			name: z.string().describe("Nombre del deployment (ej. 'psi-worker')"),
		},
		handler: async ({
			instance,
			cluster,
			namespace,
			name,
		}: { instance: string; cluster?: string; namespace: string; name: string }) => {
			const data = await rancherGet(
				instance,
				cluster ?? "local",
				`apps.deployments/${namespace}/${name}`,
			);
			return ok(data);
		},
	},
	{
		name: "rancher_list_pods",
		description:
			"Lista los pods de un cluster. Opcionalmente filtra por namespace.",
		inputSchema: {
			instance,
			cluster,
			namespace: z
				.string()
				.optional()
				.describe("Namespace para filtrar (ej. 'psi'). Si se omite, lista todos."),
		},
		handler: async ({
			instance,
			cluster,
			namespace,
		}: { instance: string; cluster?: string; namespace?: string }) => {
			const data = await rancherGet(
				instance,
				cluster ?? "local",
				"pods",
				namespace ? { "filter[metadata.namespace]": namespace } : undefined,
			);
			return ok(data);
		},
	},
	{
		name: "rancher_get_pod_logs",
		description:
			"Obtiene los logs de un pod (texto plano) vía el proxy de la K8s API de Rancher.",
		inputSchema: {
			instance,
			cluster,
			namespace: z.string().describe("Namespace del pod (ej. 'psi')"),
			pod: z.string().describe("Nombre del pod"),
			container: z
				.string()
				.optional()
				.describe("Nombre del contenedor (si el pod tiene varios)"),
			tailLines: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Cantidad de líneas finales a traer (default 200)"),
			previous: z
				.boolean()
				.optional()
				.describe("Si true, trae los logs del contenedor anterior (tras un reinicio)"),
		},
		handler: async ({
			instance,
			cluster,
			namespace,
			pod,
			container,
			tailLines,
			previous,
		}: {
			instance: string;
			cluster?: string;
			namespace: string;
			pod: string;
			container?: string;
			tailLines?: number;
			previous?: boolean;
		}) => {
			const logs = await getPodLogs(instance, cluster ?? "local", namespace, pod, {
				container,
				tailLines: tailLines ?? 200,
				previous,
			});
			return ok({ pod, namespace, container, logs });
		},
	},

	// ─── Mutaciones ───────────────────────────────────────────────────────────────
	{
		name: "rancher_restart_deployment",
		description:
			"Reinicia (redeploy / rollout restart) un deployment, recreando sus pods. Equivale al botón 'Redeploy' del dashboard.",
		inputSchema: {
			instance,
			cluster,
			namespace: z.string().describe("Namespace del deployment (ej. 'psi')"),
			name: z.string().describe("Nombre del deployment (ej. 'psi-worker')"),
		},
		handler: async ({
			instance,
			cluster,
			namespace,
			name,
		}: { instance: string; cluster?: string; namespace: string; name: string }) => {
			const clusterId = cluster ?? "local";
			const path = `apps.deployments/${namespace}/${name}`;
			const dep = (await rancherGet(instance, clusterId, path)) as SteveDeployment;

			const restartedAt = new Date().toISOString();
			dep.spec ??= {};
			dep.spec.template ??= {};
			dep.spec.template.metadata ??= {};
			dep.spec.template.metadata.annotations ??= {};
			dep.spec.template.metadata.annotations["kubectl.kubernetes.io/restartedAt"] =
				restartedAt;

			const updated = await rancherPut(instance, clusterId, path, dep);
			await emit("deployment.restarted", {
				instance,
				cluster: clusterId,
				namespace,
				name,
				restartedAt,
			});
			return ok({ restarted: true, namespace, name, restartedAt, deployment: updated });
		},
	},
	{
		name: "rancher_scale_deployment",
		description: "Cambia el número de réplicas de un deployment.",
		inputSchema: {
			instance,
			cluster,
			namespace: z.string().describe("Namespace del deployment (ej. 'psi')"),
			name: z.string().describe("Nombre del deployment (ej. 'psi-worker')"),
			replicas: z
				.number()
				.int()
				.min(0)
				.describe("Número deseado de réplicas (>= 0)"),
		},
		handler: async ({
			instance,
			cluster,
			namespace,
			name,
			replicas,
		}: {
			instance: string;
			cluster?: string;
			namespace: string;
			name: string;
			replicas: number;
		}) => {
			const clusterId = cluster ?? "local";
			const path = `apps.deployments/${namespace}/${name}`;
			const dep = (await rancherGet(instance, clusterId, path)) as SteveDeployment;

			const previousReplicas = dep.spec?.replicas;
			dep.spec ??= {};
			dep.spec.replicas = replicas;

			const updated = await rancherPut(instance, clusterId, path, dep);
			await emit("deployment.scaled", {
				instance,
				cluster: clusterId,
				namespace,
				name,
				replicas,
				previousReplicas,
			});
			return ok({
				scaled: true,
				namespace,
				name,
				replicas,
				previousReplicas,
				deployment: updated,
			});
		},
	},
];
