// ─── Depuración (slim) de respuestas de Rancher ───────────────────────────────
//
// Las APIs de Rancher devuelven objetos enormes (managedFields, annotations con
// last-applied-configuration, relationships, links, spec/status profundos). Para
// el LLM solo interesa lo esencial. Estas funciones reducen cada recurso a los
// campos útiles. Las tools exponen `raw:true` para obtener el objeto completo.

// biome-ignore lint/suspicious/noExplicitAny: las respuestas de Rancher son dinámicas
type AnyObj = Record<string, any>;

/** Extrae el array `data` de una colección (Steve o Norman); [] si no aplica */
export function collectionData(resp: unknown): AnyObj[] {
	if (resp && typeof resp === "object" && Array.isArray((resp as AnyObj).data)) {
		return (resp as AnyObj).data;
	}
	return [];
}

function fields(item: AnyObj): unknown[] {
	return item?.metadata?.fields ?? [];
}

/** Cluster (Norman /v3) → esencial */
export function slimCluster(c: AnyObj) {
	return {
		id: c.id,
		name: c.name,
		state: c.state,
		provider: c.provider,
		k8sVersion: c.version?.gitVersion,
		nodeCount: c.nodeCount,
		allocatable: c.allocatable,
		requested: c.requested,
	};
}

/** Namespace (Steve /v1) → esencial */
export function slimNamespace(n: AnyObj) {
	return {
		name: n.metadata?.name ?? n.id,
		state: n.metadata?.state?.name ?? n.status?.phase,
		project: n.metadata?.labels?.["field.cattle.io/projectId"],
		age: fields(n)[2],
	};
}

/** Deployment (Steve /v1) → resumen para listados */
export function slimDeployment(d: AnyObj) {
	const containers = d.spec?.template?.spec?.containers ?? [];
	return {
		name: d.metadata?.name,
		namespace: d.metadata?.namespace,
		state: d.metadata?.state?.name,
		replicas: d.spec?.replicas,
		ready: d.status?.readyReplicas ?? 0,
		available: d.status?.availableReplicas ?? 0,
		updated: d.status?.updatedReplicas ?? 0,
		images: containers.map((c: AnyObj) => c.image),
		age: fields(d)[4],
	};
}

/** Pod (Steve /v1) → resumen para listados */
export function slimPod(p: AnyObj) {
	const cs = p.status?.containerStatuses ?? [];
	const restarts = cs.reduce(
		(acc: number, c: AnyObj) => acc + (c.restartCount ?? 0),
		0,
	);
	return {
		name: p.metadata?.name,
		namespace: p.metadata?.namespace,
		state: p.metadata?.state?.name,
		phase: p.status?.phase,
		ready: fields(p)[1],
		restarts,
		node: p.spec?.nodeName,
		podIP: p.status?.podIP,
		images: cs.map((c: AnyObj) => c.image),
		age: fields(p)[4],
	};
}

/** Deployment (Steve /v1) → detalle (más campos, sin el bloat) */
export function slimDeploymentDetail(d: AnyObj) {
	const containers = (d.spec?.template?.spec?.containers ?? []).map(
		(c: AnyObj) => ({ name: c.name, image: c.image, resources: c.resources }),
	);
	const annotations = { ...(d.metadata?.annotations ?? {}) };
	delete annotations["kubectl.kubernetes.io/last-applied-configuration"];
	const tplAnn = d.spec?.template?.metadata?.annotations ?? {};
	const conditions = (d.status?.conditions ?? []).map((c: AnyObj) => ({
		type: c.type,
		status: c.status,
		reason: c.reason,
		message: c.message,
	}));
	return {
		name: d.metadata?.name,
		namespace: d.metadata?.namespace,
		state: d.metadata?.state?.name,
		replicas: d.spec?.replicas,
		ready: d.status?.readyReplicas ?? 0,
		available: d.status?.availableReplicas ?? 0,
		updated: d.status?.updatedReplicas ?? 0,
		strategy: d.spec?.strategy,
		containers,
		restartedAt:
			tplAnn["kubectl.kubernetes.io/restartedAt"] ?? tplAnn["cattle.io/timestamp"],
		labels: d.metadata?.labels,
		annotations,
		conditions,
		age: fields(d)[4],
	};
}
