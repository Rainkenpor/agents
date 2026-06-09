// ─── Variables de entorno del MCP de Rancher ──────────────────────────────────
//
// El MCP soporta múltiples instancias de Rancher (QA, dev, …). Cada instancia
// tiene su propia URL base y su propio token. La configuración se entrega en una
// sola variable JSON `RANCHER_INSTANCES`:
//
//   RANCHER_INSTANCES={"qa":{"url":"https://dardo-qa.distelsa.net","token":"token-xxx:yyy"},
//                      "dev":{"url":"https://dardo-dev.distelsa.net","token":"token-aaa:bbb"}}
//
// Si el JSON es inválido o no está definido, el MCP arranca igual (instancias
// vacías) para mantener el discovery funcional; las tools reportan el error
// cuando se invocan.

import { logger } from "./logger";

export interface RancherInstance {
	/** URL base de la instancia (sin slash final), ej. "https://dardo-qa.distelsa.net" */
	url: string;
	/** Token de API de Rancher; se envía como `Authorization: Bearer <token>` */
	token: string;
}

const { RANCHER_INSTANCES, SERVER_PORT, PORT } = process.env;

function parseInstances(raw: string | undefined): Record<string, RancherInstance> {
	if (!raw || !raw.trim()) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		logger.info(`[rancher] RANCHER_INSTANCES no es JSON válido: ${err}`);
		return {};
	}
	if (typeof parsed !== "object" || parsed === null) {
		logger.info("[rancher] RANCHER_INSTANCES debe ser un objeto JSON");
		return {};
	}

	const result: Record<string, RancherInstance> = {};
	for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (
			typeof value === "object" &&
			value !== null &&
			typeof (value as RancherInstance).url === "string" &&
			typeof (value as RancherInstance).token === "string"
		) {
			const { url, token } = value as RancherInstance;
			result[name] = { url: url.replace(/\/$/, ""), token };
		} else {
			logger.info(`[rancher] instancia "${name}" inválida: falta url o token`);
		}
	}
	return result;
}

const INSTANCES = parseInstances(RANCHER_INSTANCES);

export const envs = {
	PORT: Number(SERVER_PORT ?? PORT ?? 3003),
	/** Mapa nombre → {url, token} de las instancias configuradas */
	INSTANCES,
	/** Nombres de instancias disponibles, ej. ["qa", "dev"] */
	INSTANCE_NAMES: Object.keys(INSTANCES),
};
