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

export interface InstanceHealth {
	/** true si la instancia respondió y el token fue aceptado */
	reachable: boolean;
	/** Código HTTP de la respuesta (undefined si ni siquiera hubo conexión) */
	status?: number;
	/** Versión del servidor Rancher, si se pudo leer */
	serverVersion?: string;
	/** Detalle del fallo (red, TLS, 401, timeout…) cuando reachable = false */
	error?: string;
}

/**
 * Verifica que una instancia responda y que su token sea válido, consultando
 * `<url>/v3/settings/server-version` (endpoint autenticado y barato).
 * Nunca lanza: devuelve el diagnóstico para que la tool lo reporte por instancia.
 */
export async function checkInstance(
	name: string,
	timeoutMs = 5000,
): Promise<InstanceHealth> {
	let inst: RancherInstance;
	try {
		inst = resolveInstance(name);
	} catch (err) {
		return { reachable: false, error: String(err) };
	}

	const url = `${inst.url}/v3/settings/server-version`;
	try {
		const res = await fetch(
			url,
			fetchInit(inst, {
				method: "GET",
				headers: authHeaders(inst.token),
				signal: AbortSignal.timeout(timeoutMs),
			}),
		);
		const text = await res.text();
		// 403 = el token es válido pero no tiene permiso de leer settings (no es
		// admin). La instancia responde y autentica: cuenta como alcanzable.
		if (res.status === 403) {
			return {
				reachable: true,
				status: res.status,
				error: "token válido pero sin permisos para leer settings (no admin)",
			};
		}
		if (!res.ok) {
			return {
				reachable: false,
				status: res.status,
				error: `${res.status} ${res.statusText}: ${text.slice(0, 200) || "(sin cuerpo)"}`,
			};
		}
		let serverVersion: string | undefined;
		try {
			serverVersion = (JSON.parse(text) as { value?: string }).value;
		} catch {
			// respuesta no JSON: la instancia responde igual
		}
		return { reachable: true, status: res.status, serverVersion };
	} catch (err) {
		logger.info(`[rancher] ✗ check ${name} :: ${err}`);
		return { reachable: false, error: String(err) };
	}
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
