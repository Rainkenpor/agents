import type { McpModule } from "../types.ts";
import { logger } from "./logger.ts";

/**
 * Valida las credentials de todos los MCPs registrados.
 * - required: true  → lanza Error si la variable no está definida (startup abortado)
 * - required: false → loguea warn y continúa
 */
export function validateEnvs(modules: McpModule[]): void {
	let hasErrors = false;

	for (const mcp of modules) {
		if (mcp.credentials.length === 0) continue;

		for (const cred of mcp.credentials) {
			const value = process.env[cred.key];

			if (!value) {
				if (cred.required) {
					logger.error(
						`[envs] FALTA variable requerida: ${cred.key} (${mcp.displayName}) — ${cred.description}`,
					);
					hasErrors = true;
				} else {
					logger.warn(
						`[envs] ${cred.key}: no definida (opcional) — ${cred.description}`,
					);
				}
			} else {
				logger.info(`[envs] ${cred.key}: OK`);
			}
		}
	}

	if (hasErrors) {
		throw new Error(
			"Startup abortado: faltan variables de entorno requeridas. Revisa los logs.",
		);
	}
}
