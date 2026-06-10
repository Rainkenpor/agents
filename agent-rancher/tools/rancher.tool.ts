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
import {
	collectionData,
	slimCluster,
	slimNamespace,
	slimDeployment,
	slimPod,
	slimDeploymentDetail,
} from "../util/slim";

const instance = z
	.string()
	.describe("Instancia de Rancher a usar (ej. 'qa' o 'dev')");

const cluster = z
	.string()
	.optional()
	.describe("ID del cluster dentro de la instancia (default: 'local')");

const raw = z
	.boolean()
	.optional()
	.describe(
		"Si true, devuelve la respuesta completa de Rancher sin depurar (mucho más grande). Default: false.",
	);

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
			"Lista los clusters disponibles en una instancia de Rancher (id, nombre, estado, versión, nodos).",
		inputSchema: { instance, raw },
		handler: async ({ instance, raw }: { instance: string; raw?: boolean }) => {
			const data = await normanGet(instance, "clusters");
			if (raw) return ok(data);
			const items = collectionData(data).map(slimCluster);
			return ok({ count: items.length, clusters: items });
		},
	},
	{
		name: "rancher_list_namespaces",
		description:
			"Lista los namespaces de un cluster (nombre, estado, proyecto, antigüedad).",
		inputSchema: { instance, cluster, raw },
		handler: async ({
			instance,
			cluster,
			raw,
		}: { instance: string; cluster?: string; raw?: boolean }) => {
			const data = await rancherGet(instance, cluster ?? "local", "namespaces");
			if (raw) return ok(data);
			const items = collectionData(data).map(slimNamespace);
			return ok({ count: items.length, namespaces: items });
		},
	},
	{
		name: "rancher_list_deployments",
		description:
			"Lista los deployments de un cluster (nombre, namespace, réplicas, estado, imágenes). Recomendado filtrar por namespace.",
		inputSchema: {
			instance,
			cluster,
			namespace: z
				.string()
				.optional()
				.describe("Namespace para filtrar (ej. 'psi'). Si se omite, lista TODO el cluster."),
			raw,
		},
		handler: async ({
			instance,
			cluster,
			namespace,
			raw,
		}: {
			instance: string;
			cluster?: string;
			namespace?: string;
			raw?: boolean;
		}) => {
			// La Steve API filtra por namespace en la ruta: /v1/apps.deployments/<ns>
			const path = namespace
				? `apps.deployments/${namespace}`
				: "apps.deployments";
			const data = await rancherGet(instance, cluster ?? "local", path);
			if (raw) return ok(data);
			const items = collectionData(data).map(slimDeployment);
			return ok({ count: items.length, namespace, deployments: items });
		},
	},
	{
		name: "rancher_get_deployment",
		description:
			"Obtiene el detalle de un deployment (estado, réplicas, contenedores/imágenes, condiciones, anotaciones).",
		inputSchema: {
			instance,
			cluster,
			namespace: z.string().describe("Namespace del deployment (ej. 'psi')"),
			name: z.string().describe("Nombre del deployment (ej. 'psi-worker')"),
			raw,
		},
		handler: async ({
			instance,
			cluster,
			namespace,
			name,
			raw,
		}: {
			instance: string;
			cluster?: string;
			namespace: string;
			name: string;
			raw?: boolean;
		}) => {
			const data = await rancherGet(
				instance,
				cluster ?? "local",
				`apps.deployments/${namespace}/${name}`,
			);
			if (raw) return ok(data);
			return ok(slimDeploymentDetail(data as Record<string, unknown>));
		},
	},
	{
		name: "rancher_list_pods",
		description:
			"Lista los pods de un cluster (nombre, namespace, estado, reinicios, nodo, IP, imágenes). Recomendado filtrar por namespace.",
		inputSchema: {
			instance,
			cluster,
			namespace: z
				.string()
				.optional()
				.describe("Namespace para filtrar (ej. 'psi'). Si se omite, lista TODO el cluster."),
			raw,
		},
		handler: async ({
			instance,
			cluster,
			namespace,
			raw,
		}: {
			instance: string;
			cluster?: string;
			namespace?: string;
			raw?: boolean;
		}) => {
			// La Steve API filtra por namespace en la ruta: /v1/pods/<ns>
			const path = namespace ? `pods/${namespace}` : "pods";
			const data = await rancherGet(instance, cluster ?? "local", path);
			if (raw) return ok(data);
			const items = collectionData(data).map(slimPod);
			return ok({ count: items.length, namespace, pods: items });
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
			return ok({
				restarted: true,
				namespace,
				name,
				restartedAt,
				deployment: slimDeploymentDetail(updated as Record<string, unknown>),
			});
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
				deployment: slimDeploymentDetail(updated as Record<string, unknown>),
			});
		},
	},
];
