// ─── Cliente HTTP para Rancher (Steve API + Norman API) ───────────────────────
//
// El dashboard de Rancher usa internamente dos APIs:
//   - Steve API:  <url>/k8s/clusters/<cluster>/v1/<recurso>   (recursos del cluster)
//   - Norman API: <url>/v3/<recurso>                          (gestión: clusters…)
//
// Para logs de pods se usa el proxy crudo de la K8s API que expone Rancher:
//   <url>/k8s/clusters/<cluster>/api/v1/namespaces/<ns>/pods/<pod>/log
//
// Autenticación: token de API de Rancher vía `Authorization: Bearer <token>`.
// A diferencia de otros MCPs, aquí NO hay una única BASE_URL/token de entorno:
// cada llamada resuelve la instancia (qa, dev, …) por nombre.

import { envs, type RancherInstance } from "./envs";
import { logger } from "./logger";

/** Resuelve una instancia por nombre o lanza un error claro con las disponibles */
export function resolveInstance(name: string): RancherInstance {
	const inst = envs.INSTANCES[name];
	if (!inst) {
		const available = envs.INSTANCE_NAMES.length
			? envs.INSTANCE_NAMES.join(", ")
			: "(ninguna configurada en RANCHER_INSTANCES)";
		throw new Error(
			`Instancia de Rancher "${name}" no encontrada. Instancias disponibles: ${available}`,
		);
	}
	return inst;
}

function authHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/json",
	};
}

/**
 * Opciones extra de fetch según la instancia. Para instancias con
 * `insecureTLS: true` (certificados self-signed / CA interna) se desactiva la
 * verificación del certificado vía la opción `tls` de Bun.
 */
function fetchInit(inst: RancherInstance, init: RequestInit): RequestInit {
	if (inst.insecureTLS) {
		return { ...init, tls: { rejectUnauthorized: false } } as RequestInit;
	}
	return init;
}

function withParams(url: URL, params?: Record<string, unknown>): URL {
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null || value === "") continue;
			url.searchParams.set(key, String(value));
		}
	}
	return url;
}

/** URL de la Steve API: <url>/k8s/clusters/<cluster>/v1/<path> */
function steveUrl(
	inst: RancherInstance,
	cluster: string,
	path: string,
	params?: Record<string, unknown>,
): URL {
	const clean = path.replace(/^\//, "");
	const url = new URL(`${inst.url}/k8s/clusters/${cluster}/v1/${clean}`);
	return withParams(url, params);
}

async function parseResponse(res: Response, url: string): Promise<unknown> {
	const text = await res.text();
	if (!res.ok) {
		logger.info(`[rancher] ✗ ${res.status} ${url} :: ${text.slice(0, 200)}`);
		throw new Error(
			`Rancher API ${res.status} ${res.statusText}: ${text || "(sin cuerpo)"}`,
		);
	}
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** GET autenticado contra la Steve API */
export async function rancherGet(
	instance: string,
	cluster: string,
	path: string,
	params?: Record<string, unknown>,
): Promise<unknown> {
	const inst = resolveInstance(instance);
	const url = steveUrl(inst, cluster, path, params).toString();
	logger.info(`[rancher] → GET ${url}`);
	const res = await fetch(
		url,
		fetchInit(inst, { method: "GET", headers: authHeaders(inst.token) }),
	);
	return parseResponse(res, url);
}

/** PUT autenticado contra la Steve API (reemplaza el recurso completo) */
export async function rancherPut(
	instance: string,
	cluster: string,
	path: string,
	body: unknown,
): Promise<unknown> {
	const inst = resolveInstance(instance);
	const url = steveUrl(inst, cluster, path).toString();
	logger.info(`[rancher] → PUT ${url}`);
	const res = await fetch(
		url,
		fetchInit(inst, {
			method: "PUT",
			headers: { ...authHeaders(inst.token), "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
	return parseResponse(res, url);
}

/** GET autenticado contra la Norman API: <url>/v3/<path> */
export async function normanGet(
	instance: string,
	path: string,
	params?: Record<string, unknown>,
): Promise<unknown> {
	const inst = resolveInstance(instance);
	const clean = path.replace(/^\//, "");
	const url = withParams(new URL(`${inst.url}/v3/${clean}`), params).toString();
	logger.info(`[rancher] → GET ${url}`);
	const res = await fetch(
		url,
		fetchInit(inst, { method: "GET", headers: authHeaders(inst.token) }),
	);
	return parseResponse(res, url);
}

export interface PodLogOptions {
	container?: string;
	tailLines?: number;
	previous?: boolean;
}

/**
 * Obtiene los logs de un pod vía el proxy de la K8s API de Rancher.
 * Devuelve texto plano (no JSON).
 */
export async function getPodLogs(
	instance: string,
	cluster: string,
	namespace: string,
	pod: string,
	opts: PodLogOptions = {},
): Promise<string> {
	const inst = resolveInstance(instance);
	const url = new URL(
		`${inst.url}/k8s/clusters/${cluster}/api/v1/namespaces/${namespace}/pods/${pod}/log`,
	);
	withParams(url, {
		container: opts.container,
		tailLines: opts.tailLines,
		previous: opts.previous,
	});
	const target = url.toString();
	logger.info(`[rancher] → GET (logs) ${target}`);
	// El endpoint de logs del kube-apiserver responde 406 si el Accept no es uno
	// que pueda satisfacer. kubectl no restringe el Accept (usa */*) y así el
	// subrecurso /log devuelve el texto plano. Replicamos ese comportamiento.
	const res = await fetch(
		target,
		fetchInit(inst, {
			method: "GET",
			headers: { Authorization: `Bearer ${inst.token}`, Accept: "*/*" },
		}),
	);
	const text = await res.text();
	if (!res.ok) {
		logger.info(`[rancher] ✗ ${res.status} ${target} :: ${text.slice(0, 200)}`);
		throw new Error(
			`Rancher logs ${res.status} ${res.statusText}: ${text || "(sin cuerpo)"}`,
		);
	}
	return text;
}
